import type { ActivePhase, Atmosphere, DirectorCtrl, DurationMin, InterviewPhase } from './types';

/** 阶段顺序。状态机只按这个顺序推进 */
export const PHASE_ORDER: ActivePhase[] = ['intro', 'project', 'fundamentals', 'scenario', 'reverse'];

/** 单段静音切句（毫秒） */
export const SEGMENT_SILENCE_MS = 800;

/** 单个 ASR 段的上限（毫秒），防止连接过长 */
export const SEGMENT_MAX_MS = 15_000;

/** 一轮回答的提交静音阈值（毫秒） */
export const TURN_SILENCE_MS = 2_500;

/** 一轮回答的硬上限（毫秒） */
export const TURN_HARD_LIMIT_MS = 90_000;

/** 催促阈值（毫秒），从本轮第一个语音段开始计时 */
export const NUDGE_MS: Record<Atmosphere, number> = {
  gentle: 120_000,
  standard: 90_000,
  pressure: 60_000,
};

/** 每档氛围允许的追问层数上限 */
export const FOLLOW_UP_LIMIT: Record<Atmosphere, number> = {
  gentle: 1,
  standard: 2,
  pressure: 3,
};

/** 术语归一的超时（毫秒）；超时直接放弃，不阻塞面试官回复 */
export const NORMALIZE_TIMEOUT_MS = 800;

/** barge-in 判定的连续能量时长（毫秒） */
export const BARGE_IN_ENERGY_MS = 300;

/** 冷场等待（毫秒），到点面试官主动引导 */
export const SILENCE_PROMPT_MS: Record<Atmosphere, number> = {
  gentle: 8_000,
  standard: 5_000,
  pressure: 3_000,
};

type PhaseQuota = Record<ActivePhase, { min: number; max: number }>;

/**
 * 各时长的阶段题量规划。
 * 15 分钟压缩后期；40 分钟加长项目深挖；其余用设计稿基准。
 */
const PLANS: Record<DurationMin, PhaseQuota> = {
  15: {
    intro: { min: 1, max: 2 },
    project: { min: 3, max: 4 },
    fundamentals: { min: 2, max: 3 },
    scenario: { min: 2, max: 2 },
    reverse: { min: 1, max: 1 },
  },
  25: {
    intro: { min: 1, max: 2 },
    project: { min: 3, max: 5 },
    fundamentals: { min: 2, max: 4 },
    scenario: { min: 2, max: 3 },
    reverse: { min: 1, max: 1 },
  },
  40: {
    intro: { min: 1, max: 2 },
    project: { min: 4, max: 5 },
    fundamentals: { min: 3, max: 4 },
    scenario: { min: 2, max: 3 },
    reverse: { min: 1, max: 1 },
  },
};

export function phasePlan(d: DurationMin): PhaseQuota {
  return PLANS[d];
}

function nextPhase(phase: ActivePhase): InterviewPhase {
  const i = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[i + 1] ?? 'done';
}

/**
 * 模型没给出（或给坏了）控制行时的兜底决策。
 * 调用方保证 askedInPhase >= 1（开场题已出）。
 */
export function decideFallback(input: {
  phase: ActivePhase;
  durationMin: DurationMin;
  askedInPhase: number;
  followUps: number;
  atmosphere: Atmosphere;
}): DirectorCtrl {
  const { phase, durationMin, askedInPhase, followUps, atmosphere } = input;
  const quota = phasePlan(durationMin)[phase];

  // 追问层数用满 → 强制推进
  if (followUps >= FOLLOW_UP_LIMIT[atmosphere]) {
    return advance(phase, askedInPhase, quota.max);
  }

  // 已到本阶段上限 → 强制推进
  if (askedInPhase >= quota.max) {
    return advance(phase, askedInPhase, quota.max);
  }

  // 还没到下限 → 继续在本阶段出新题
  if (askedInPhase < quota.min) {
    return { move: 'advance', phase, asked: askedInPhase + 1 };
  }

  return { move: 'follow_up', phase, asked: askedInPhase };
}

function advance(phase: ActivePhase, askedInPhase: number, max: number): DirectorCtrl {
  const target = askedInPhase >= max ? nextPhase(phase) : phase;
  if (target === 'done') {
    return { move: 'close', phase: 'done', asked: askedInPhase };
  }
  return {
    move: 'advance',
    phase: target,
    asked: target === phase ? askedInPhase + 1 : 1,
  };
}
