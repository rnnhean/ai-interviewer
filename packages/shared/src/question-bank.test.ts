import { describe, expect, it } from 'vitest';
import { pickQuestion, QUESTION_BANK } from './question-bank';
import { PHASE_ORDER } from './limits';
import type { DimensionKey } from './types';

describe('QUESTION_BANK', () => {
  it('每个能力维度至少 2 道题', () => {
    const dims: DimensionKey[] = ['technical', 'decomposition', 'tradeoff', 'verification', 'communication'];
    for (const d of dims) {
      expect(QUESTION_BANK.filter((q) => q.dimension === d).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('覆盖五个阶段，且 scenario 题一定带展示文本', () => {
    for (const p of PHASE_ORDER) {
      expect(QUESTION_BANK.some((q) => q.phase === p)).toBe(true);
    }
    const scenario = QUESTION_BANK.filter((q) => q.phase === 'scenario');
    expect(scenario.every((q) => q.displayText.includes('```') || q.displayText.length > 40)).toBe(true);
  });

  it('speechText 不含代码围栏', () => {
    expect(QUESTION_BANK.every((q) => !q.speechText.includes('```'))).toBe(true);
  });

  it('id 唯一', () => {
    const ids = QUESTION_BANK.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pickQuestion', () => {
  it('跳过已用过的题', () => {
    const all = QUESTION_BANK.filter((q) => q.phase === 'intro');
    const got = pickQuestion('intro', [all[0]!.id]);
    expect(got?.id).not.toBe(all[0]!.id);
  });

  it('题用完后返回 null', () => {
    const used = QUESTION_BANK.filter((q) => q.phase === 'reverse').map((q) => q.id);
    expect(pickQuestion('reverse', used)).toBeNull();
  });
});
