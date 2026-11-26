import { describe, expect, it } from 'vitest';
import { createBargeInDetector } from './barge-in';

describe('createBargeInDetector', () => {
  it('连续 300ms 超阈值才触发', () => {
    const d = createBargeInDetector({ energyMs: 300, threshold: 0.05 });
    expect(d.feed(0.1, 0)).toBe(false);
    expect(d.feed(0.1, 100)).toBe(false);
    expect(d.feed(0.1, 200)).toBe(false);
    expect(d.feed(0.1, 300)).toBe(true);
  });

  it('中途掉回阈值以下则重新计时', () => {
    const d = createBargeInDetector({ energyMs: 300, threshold: 0.05 });
    d.feed(0.1, 0);
    d.feed(0.01, 150);
    d.feed(0.1, 200);
    d.feed(0.1, 400);
    expect(d.feed(0.1, 450)).toBe(false);
  });

  it('触发一次后不重复触发，直到 reset', () => {
    const d = createBargeInDetector({ energyMs: 300, threshold: 0.05 });
    d.feed(0.1, 0);
    expect(d.feed(0.1, 300)).toBe(true);
    expect(d.feed(0.1, 600)).toBe(false);
    d.reset();
    expect(d.feed(0.1, 700)).toBe(false);
    expect(d.feed(0.1, 1000)).toBe(true);
  });

  it('一直低于阈值不触发', () => {
    const d = createBargeInDetector({ energyMs: 300, threshold: 0.05 });
    for (let t = 0; t <= 5000; t += 100) expect(d.feed(0.01, t)).toBe(false);
  });
});
