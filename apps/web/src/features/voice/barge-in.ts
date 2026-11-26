export interface BargeInOptions {
  /** 连续超过阈值多久才判定为打断（毫秒） */
  energyMs: number;
  /** 能量阈值（均方根） */
  threshold: number;
}

/**
 * 检测候选人是否在数字人说话时开口。
 * 连续 `energyMs` 都超过阈值才算；中间掉下来就重新计时。
 * 触发一次后进入锁定状态，直到 `reset()`。
 */
export function createBargeInDetector(options: BargeInOptions) {
  let aboveSince: number | null = null;
  let fired = false;

  return {
    feed(level: number, at: number): boolean {
      if (fired) return false;
      if (level < options.threshold) {
        aboveSince = null;
        return false;
      }
      aboveSince ??= at;
      if (at - aboveSince >= options.energyMs) {
        fired = true;
        return true;
      }
      return false;
    },

    reset(): void {
      aboveSince = null;
      fired = false;
    },
  };
}

export type BargeInDetector = ReturnType<typeof createBargeInDetector>;
