import { describe, expect, it } from 'vitest';
import { decideFallback, phasePlan, PHASE_ORDER } from './limits';

describe('phasePlan', () => {
  it('15 分钟压缩后期阶段', () => {
    const p = phasePlan(15);
    expect(p.intro).toEqual({ min: 1, max: 2 });
    expect(p.project).toEqual({ min: 3, max: 4 });
    expect(p.scenario).toEqual({ min: 2, max: 2 });
    expect(PHASE_ORDER).toEqual(['intro', 'project', 'fundamentals', 'scenario', 'reverse']);
  });

  it('40 分钟加长项目深挖', () => {
    expect(phasePlan(40).project).toEqual({ min: 4, max: 5 });
  });
});

describe('decideFallback', () => {
  const base = { phase: 'project' as const, durationMin: 25 as const };

  it('阶段题量没到下限时继续在同一阶段出新题', () => {
    expect(decideFallback({ ...base, askedInPhase: 1, followUps: 0, atmosphere: 'standard' })).toEqual({
      move: 'advance',
      phase: 'project',
      asked: 2,
    });
  });

  it('已到下限且追问额度未用完时追问', () => {
    expect(decideFallback({ ...base, askedInPhase: 3, followUps: 0, atmosphere: 'standard' })).toEqual({
      move: 'follow_up',
      phase: 'project',
      asked: 3,
    });
  });

  it('压力面追问额度用满即推进', () => {
    expect(decideFallback({ ...base, askedInPhase: 3, followUps: 3, atmosphere: 'pressure' })).toEqual({
      move: 'advance',
      phase: 'project',
      asked: 4,
    });
  });

  it('超过本阶段上限时进入下一阶段', () => {
    expect(decideFallback({ ...base, askedInPhase: 5, followUps: 1, atmosphere: 'standard' })).toEqual({
      move: 'advance',
      phase: 'fundamentals',
      asked: 1,
    });
  });

  it('reverse 之后进入 done', () => {
    expect(
      decideFallback({
        phase: 'reverse',
        durationMin: 25,
        askedInPhase: 1,
        followUps: 1,
        atmosphere: 'gentle',
      }),
    ).toEqual({ move: 'close', phase: 'done', asked: 1 });
  });
});
