import { createUIMessageStream, streamText, type InferUIMessageChunk, type LanguageModel, type UIMessage } from 'ai';
import {
  decideFallback,
  type ActivePhase,
  type DirectorCtrl,
  type InterviewDataParts,
} from '@ai-interviewer/shared';
import { DirectorStreamParser } from '../llm/director-parser';
import { buildSystemPrompt } from '../llm/prompts';
import { SpeechStreamer } from '../llm/speech-stream';
import type { InterviewService } from './session.store';

/** 前端使用的消息类型 */
export type InterviewUIMessage = UIMessage<unknown, InterviewDataParts>;

export type TurnChunk = InferUIMessageChunk<InterviewUIMessage>;

export type TurnWriter = { write: (chunk: TurnChunk) => void };

export interface TtsSink {
  speak(sessionId: string, turnId: string, text: string): void;
  finishTurn(sessionId: string, turnId: string): void;
  abortTurn(sessionId: string, turnId: string): void;
}

export interface TurnDeps {
  model: LanguageModel;
  interviews: InterviewService;
  tts: TtsSink;
  now?: () => number;
}

export interface TurnInput {
  sessionId: string;
  text: string;
  source?: 'voice' | 'text';
}

/**
 * 一次面试官发言（问题或追问）的流式生成。
 * 输入是候选人的回答；输出是面试官的话 + 阶段决策。
 */
export function createTurnStream(deps: TurnDeps, input: TurnInput): ReadableStream<TurnChunk> {
  return createUIMessageStream<InterviewUIMessage>({
    execute: async ({ writer }) => {
      const session = deps.interviews.require(input.sessionId);
      deps.interviews.assertActive(input.sessionId);

      // 候选人的这次回答先入账（针对的是上一问）
      deps.interviews.commitRound(input.sessionId, {
        answer: input.text,
        source: input.source ?? 'text',
        interrupted: false,
        now: deps.now?.(),
      });

      await generateInterviewerLine(deps, writer, {
        sessionId: input.sessionId,
        userPrompt: input.text,
        isOpening: false,
      });
    },
  });
}

/** 开场：生成问候 + 第一题，没有用户输入 */
export function createOpeningStream(deps: TurnDeps, sessionId: string): ReadableStream<TurnChunk> {
  return createUIMessageStream<InterviewUIMessage>({
    execute: async ({ writer }) => {
      deps.interviews.require(sessionId);
      deps.interviews.assertActive(sessionId);
      await generateInterviewerLine(deps, writer, {
        sessionId,
        userPrompt:
          '面试现在开始。请用一句话问候，然后直接问第一道开场问题。控制行用 move=advance、phase=intro、asked=1。',
        isOpening: true,
      });
    },
  });
}

interface LineInput {
  sessionId: string;
  userPrompt: string;
  isOpening: boolean;
}

/** 面试官发言的公共流程：流式正文 → 控制行解析 → 兜底 → 落库 → TTS */
async function generateInterviewerLine(deps: TurnDeps, writer: TurnWriter, input: LineInput): Promise<void> {
  const { sessionId } = input;
  const session = deps.interviews.require(sessionId);

  const turnId = `turn-${session.rounds.length + 1}-${Date.now()}`;
  const controller = new AbortController();
  deps.interviews.setTurnController(sessionId, controller);

  const system = buildSystemPrompt({ snapshot: deps.interviews.snapshot(sessionId) });

  const result = streamText({
    model: deps.model,
    system,
    prompt: input.userPrompt,
    abortSignal: controller.signal,
  });

  const parser = new DirectorStreamParser();
  const speech = new SpeechStreamer((text) => deps.tts.speak(sessionId, turnId, text));
  let startedText = false;
  let fullText = '';
  let ctrl: DirectorCtrl | undefined;

  const writeText = (delta: string) => {
    if (delta === '') return;
    if (!startedText) {
      writer.write({ type: 'text-start', id: turnId });
      startedText = true;
    }
    fullText += delta;
    // TTS 只吃能朗读的部分，整句送出；代码围栏在这里被拦掉
    speech.push(delta);
    writer.write({ type: 'text-delta', id: turnId, delta });
  };

  const endText = () => {
    if (startedText) {
      writer.write({ type: 'text-end', id: turnId });
      startedText = false;
    }
  };

  try {
    for await (const chunk of result.textStream) {
      const out = parser.push(chunk);
      if (out.ctrl) {
        ctrl = out.ctrl;
        writeDirector(writer, out.ctrl);
      }
      writeText(out.text);
    }
    const tail = parser.flush();
    if (tail.ctrl) {
      ctrl = tail.ctrl;
      writeDirector(writer, tail.ctrl);
    }
    writeText(tail.text);

    if (!ctrl) {
      ctrl = fallbackCtrl(deps, sessionId);
      deps.interviews.noteFormatViolation(sessionId);
      writeDirector(writer, ctrl);
    }

    endText();

    // 收尾：剩下的不足一句的文本
    speech.flush();

    // 记录这一轮的「问题」并推进状态机
    const question = fullText.trim();
    deps.interviews.setCurrentQuestion(sessionId, question);
    deps.interviews.setTurnController(sessionId, undefined);

    if (input.isOpening) {
      session.askedTotal = 1;
      session.askedInPhase = 1;
      session.phase = 'intro';
    } else {
      deps.interviews.applyDirector(sessionId, ctrl);
    }

    deps.tts.finishTurn(sessionId, turnId);
    writer.write({ type: 'data-tts', data: { turnId, state: 'done' } });
  } catch (err) {
    endText();
    deps.interviews.setTurnController(sessionId, undefined);
    deps.tts.abortTurn(sessionId, turnId);
    if (isAbort(err)) {
      writer.write({ type: 'data-tts', data: { turnId, state: 'aborted' } });
      return;
    }
    writer.write({ type: 'data-tts', data: { turnId, state: 'error' } });
    writer.write({ type: 'error', errorText: '生成失败，请重试' });
  }
}

function writeDirector(writer: TurnWriter, ctrl: DirectorCtrl): void {
  writer.write({ type: 'data-director', data: ctrl });
  writer.write({ type: 'data-phase', data: { phase: ctrl.phase, askedInPhase: ctrl.asked } });
}

function fallbackCtrl(deps: TurnDeps, sessionId: string): DirectorCtrl {
  const s = deps.interviews.require(sessionId);
  const phase: ActivePhase = s.phase === 'done' ? 'reverse' : (s.phase as ActivePhase);
  return decideFallback({
    phase,
    durationMin: s.durationMin,
    askedInPhase: Math.max(1, s.askedInPhase),
    followUps: s.followUps,
    atmosphere: s.atmosphere,
  });
}

function isAbort(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
}
