/** 岗位方向 */
export type Track = 'agent-engineer' | 'frontend-to-agent' | 'backend-ai';

/** 面试氛围 */
export type Atmosphere = 'gentle' | 'standard' | 'pressure';

/** 面试时长（分钟） */
export type DurationMin = 15 | 25 | 40;

/** 阶段。done 是终态，不参与题量规划 */
export type InterviewPhase = 'intro' | 'project' | 'fundamentals' | 'scenario' | 'reverse' | 'done';

/** 非终态阶段，即走状态机的那些 */
export type ActivePhase = Exclude<InterviewPhase, 'done'>;

/** 五维评分的 key */
export type DimensionKey = 'technical' | 'decomposition' | 'tradeoff' | 'verification' | 'communication';

/** 回答来源 */
export type AnswerSource = 'voice' | 'text';

/** 会话状态 */
export type SessionStatus = 'active' | 'finishing' | 'finished';

/** 导演决策：这一轮是追问、推进还是收尾 */
export interface DirectorCtrl {
  move: 'follow_up' | 'advance' | 'close';
  phase: InterviewPhase;
  /** 本阶段已出题数（追问不增加） */
  asked: number;
}

/** 单轮记录 */
export interface Round {
  index: number;
  question: string;
  /** 评审题里展示给候选人的代码/需求文本；口播文本在 question 里 */
  displayText?: string;
  answer: string;
  source: AnswerSource;
  submittedAt: number;
  /** 面试官说话时被打断：本轮回答是半句话 */
  interrupted: boolean;
}

/** 预置题库条目 */
export interface QuestionItem {
  id: string;
  dimension: DimensionKey;
  phase: ActivePhase;
  /** 显示文本，可含代码围栏；不朗读 */
  displayText: string;
  /** 口播文本，不含代码 */
  speechText: string;
}

/** 会话快照（对外的只读视图） */
export interface SessionSnapshot {
  id: string;
  track: Track;
  atmosphere: Atmosphere;
  durationMin: DurationMin;
  phase: InterviewPhase;
  /** 全会话已出题总数 */
  askedTotal: number;
  /** 当前阶段已出题数 */
  askedInPhase: number;
  /** 当前阶段已追问层数 */
  followUps: number;
  startedAt: number;
  status: SessionStatus;
  rounds: Round[];
  resumeText?: string;
  report?: InterviewReport;
}

/** 五维之一 */
export interface DimensionScore {
  key: DimensionKey;
  score: number;
  comment: string;
}

/** 好的地方：引用原话 + 为什么好 */
export interface Strength {
  quote: string;
  why: string;
}

/** 不足：引用原话 + 问题 + 建议 */
export interface Gap {
  quote: string;
  issue: string;
  suggestion: string;
}

/** 面试评价报告 */
export interface InterviewReport {
  total: number;
  dimensions: DimensionScore[];
  strengths: Strength[];
  gaps: Gap[];
  actions: string[];
  /** 模型生成失败、走了降级路径时为 true */
  fallback?: boolean;
}

/** 前端 UI 消息上的自定义 data part 载荷 */
export type InterviewDataParts = {
  phase: { phase: InterviewPhase; askedInPhase: number };
  director: DirectorCtrl;
  tts: { turnId: string; state: 'started' | 'done' | 'aborted' | 'error' };
};

/** 创建会话的入参 */
export interface CreateSessionInput {
  track: Track;
  atmosphere: Atmosphere;
  durationMin: DurationMin;
  resumeText?: string;
}
