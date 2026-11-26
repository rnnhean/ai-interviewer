import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  FOLLOW_UP_LIMIT,
  PHASE_ORDER,
  phasePlan,
  type ActivePhase,
  type AnswerSource,
  type CreateSessionInput,
  type DirectorCtrl,
  type InterviewPhase,
  type Round,
  type SessionSnapshot,
  type SessionStatus,
} from '@ai-interviewer/shared';

/** 会话内部状态：比快照多出进行中轮次的临时数据 */
export interface SessionState extends SessionSnapshot {
  /** 面试官当前这一问的完整文本；开场白生成后写入，每次生成新一轮后更新 */
  currentQuestion: string;
  /** 候选人的回答正在累积（语音分段的中间态） */
  pendingAnswer: string;
  /** 本轮 LLM 生成的 abort controller */
  turnController?: AbortController;
  /** 模型没按格式输出控制行的次数 */
  formatViolations: number;
  /** 已经用过的题目 id */
  usedQuestionIds: string[];
}

@Injectable()
export class SessionStore {
  private readonly map = new Map<string, SessionState>();

  set(s: SessionState): void {
    this.map.set(s.id, s);
  }

  get(id: string): SessionState | undefined {
    return this.map.get(id);
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

@Injectable()
export class InterviewService {
  constructor(@Inject(SessionStore) private readonly store: SessionStore) {}

  create(input: CreateSessionInput, id: string, now = Date.now()): SessionState {
    const state: SessionState = {
      id,
      track: input.track,
      atmosphere: input.atmosphere,
      durationMin: input.durationMin,
      phase: 'intro',
      askedTotal: 0,
      askedInPhase: 0,
      followUps: 0,
      startedAt: now,
      status: 'active',
      rounds: [],
      currentQuestion: '',
      pendingAnswer: '',
      formatViolations: 0,
      usedQuestionIds: [],
    };
    if (input.resumeText && input.resumeText.trim() !== '') {
      state.resumeText = input.resumeText.trim();
    }
    this.store.set(state);
    return state;
  }

  require(id: string): SessionState {
    const s = this.store.get(id);
    if (!s) throw new NotFoundException('会话已丢失');
    return s;
  }

  /** 对外快照：抹掉内部字段 */
  snapshot(id: string): SessionSnapshot {
    const s = this.require(id);
    return {
      id: s.id,
      track: s.track,
      atmosphere: s.atmosphere,
      durationMin: s.durationMin,
      phase: s.phase,
      askedTotal: s.askedTotal,
      askedInPhase: s.askedInPhase,
      followUps: s.followUps,
      startedAt: s.startedAt,
      status: s.status,
      rounds: [...s.rounds],
      ...(s.resumeText !== undefined ? { resumeText: s.resumeText } : {}),
      ...(s.report !== undefined ? { report: s.report } : {}),
    };
  }

  noteFormatViolation(id: string): void {
    this.require(id).formatViolations += 1;
  }

  markUsedQuestion(id: string, questionId: string): void {
    const s = this.require(id);
    if (!s.usedQuestionIds.includes(questionId)) s.usedQuestionIds.push(questionId);
  }

  /** 面试官说完一轮：把这一轮的问题文本记为「当前问题」 */
  setCurrentQuestion(id: string, text: string): void {
    this.require(id).currentQuestion = text.trim();
  }

  /** 累计候选人的回答（语音多段或文字一次性） */
  appendAnswer(id: string, delta: string): void {
    this.require(id).pendingAnswer += delta;
  }

  /** 清空回答缓冲（提交后被调用） */
  clearPendingAnswer(id: string): void {
    this.require(id).pendingAnswer = '';
  }

  setTurnController(id: string, controller: AbortController | undefined): void {
    const s = this.require(id);
    if (controller) s.turnController = controller;
    else delete s.turnController;
  }

  /**
   * 把「上一问 + 候选人的回答」落成一条轮次。
   * 空回答不记录（VAD 误触发的场景）。
   */
  commitRound(
    id: string,
    input: { answer: string; source: AnswerSource; interrupted: boolean; now?: number },
  ): Round | null {
    const s = this.require(id);
    const answer = input.answer.trim();
    if (answer === '') return null;

    const round: Round = {
      index: s.rounds.length + 1,
      question: s.currentQuestion,
      answer,
      source: input.source,
      submittedAt: input.now ?? Date.now(),
      interrupted: input.interrupted,
    };
    s.rounds.push(round);
    s.pendingAnswer = '';
    return round;
  }

  /**
   * 打断：保留半句话并标记 interrupted。
   * 返回是否真的打断了一个进行中的轮次。
   */
  interrupt(id: string): boolean {
    const s = this.store.get(id);
    if (!s) return false;

    let didSomething = false;

    // 1) 停掉正在生成的面试官回复
    if (s.turnController) {
      try {
        s.turnController.abort();
      } catch {
        /* 已 abort 时忽略 */
      }
      delete s.turnController;
      didSomething = true;
    }

    // 2) 若有半句话的回答，落盘并标记
    if (s.pendingAnswer.trim() !== '') {
      this.commitRound(id, { answer: s.pendingAnswer, source: 'voice', interrupted: true });
      didSomething = true;
    }

    return didSomething;
  }

  /** 应用导演决策，推进阶段与计数 */
  applyDirector(id: string, ctrl: DirectorCtrl): void {
    const s = this.require(id);
    const prevPhase: InterviewPhase = s.phase;

    if (ctrl.move === 'close') {
      s.phase = 'done';
      return;
    }

    if (ctrl.move === 'follow_up') {
      // 模型可能一直追问不放；追问层数或本阶段题量用满时必须推进，
      // 否则整场面试会卡在开场阶段出不来
      s.followUps += 1;
      if (this.followUpExhausted(s) || this.phaseQuotaFilled(s)) {
        this.advancePhase(s);
      }
      return;
    }

    s.askedTotal += 1;
    if (ctrl.phase === prevPhase) {
      s.askedInPhase = ctrl.asked;
    } else {
      s.askedInPhase = 1;
      s.followUps = 0;
      s.phase = ctrl.phase;
    }
  }

  /** 追问层数是否已达到当前氛围的上限 */
  private followUpExhausted(s: SessionState): boolean {
    return s.followUps >= FOLLOW_UP_LIMIT[s.atmosphere];
  }

  /** 本阶段出的题是否已达上限 */
  private phaseQuotaFilled(s: SessionState): boolean {
    if (s.phase === 'done') return true;
    const quota = phasePlan(s.durationMin)[s.phase as ActivePhase];
    return quota !== undefined && s.askedInPhase >= quota.max;
  }

  /** 按 PHASE_ORDER 推进一步，同时把题量 +1、追问清零 */
  private advancePhase(s: SessionState): void {
    const i = PHASE_ORDER.indexOf(s.phase as ActivePhase);
    if (i === -1 || i === PHASE_ORDER.length - 1) {
      s.phase = 'done';
      return;
    }
    const next = PHASE_ORDER[i + 1];
    if (next === undefined) {
      s.phase = 'done';
      return;
    }
    s.phase = next;
    s.askedTotal += 1;
    s.askedInPhase = 1;
    s.followUps = 0;
  }

  markFinishing(id: string): void {
    this.require(id).status = 'finishing';
  }

  markFinished(id: string, report?: SessionSnapshot['report']): void {
    const s = this.require(id);
    s.status = 'finished';
    if (report) s.report = report;
    if (s.turnController) {
      try {
        s.turnController.abort();
      } catch {
        /* ignore */
      }
      delete s.turnController;
    }
    s.pendingAnswer = '';
  }

  /** 会话是否还能继续回答 */
  assertActive(id: string): void {
    const s = this.require(id);
    if (s.status !== 'active') {
      throw new BadRequestException('面试已结束，不能继续作答');
    }
  }
}
