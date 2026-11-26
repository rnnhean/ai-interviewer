import type { SessionSnapshot } from '@ai-interviewer/shared';
import { describe, expect, it } from 'vitest';
import { exportFileName, toJson, toMarkdown } from './export.service';

function snap(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: 's1',
    track: 'frontend-to-agent',
    atmosphere: 'standard',
    durationMin: 25,
    phase: 'done',
    askedTotal: 2,
    askedInPhase: 1,
    followUps: 0,
    startedAt: new Date('2026-11-04T09:30:00').getTime(),
    status: 'finished',
    rounds: [
      {
        index: 1,
        question: 'RAG 的召回怎么做？',
        answer: '先做粗召回再做 rerank',
        source: 'voice',
        submittedAt: new Date('2026-11-04T09:31:00').getTime(),
        interrupted: false,
      },
      {
        index: 2,
        question: '怎么验证效果？',
        answer: '我加了一条回归用例',
        source: 'text',
        submittedAt: new Date('2026-11-04T09:33:00').getTime(),
        interrupted: false,
      },
    ],
    ...overrides,
  };
}

const REPORT = {
  total: 72,
  dimensions: [
    { key: 'technical' as const, score: 7, comment: '原理清楚' },
    { key: 'decomposition' as const, score: 8, comment: '先拆再动手' },
    { key: 'tradeoff' as const, score: 6, comment: '代价没量化' },
    { key: 'verification' as const, score: 7, comment: '有验证意识' },
    { key: 'communication' as const, score: 7, comment: '结论先行' },
  ],
  strengths: [{ quote: '先做粗召回再做 rerank', why: '链路分层清楚' }],
  gaps: [{ quote: '效果还行', issue: '没有量化', suggestion: '补上数字' }],
  actions: ['回答先给结论', '准备三个关键数字', '不会的题先说思路'],
};

describe('toMarkdown', () => {
  it('每条轮次的问题与回答都出现', () => {
    const md = toMarkdown(snap());
    expect(md).toContain('第 1 轮');
    expect(md).toContain('第 2 轮');
    expect(md).toContain('RAG 的召回怎么做');
    expect(md).toContain('先做粗召回再做 rerank');
  });

  it('标记回答来源与时间', () => {
    const md = toMarkdown(snap());
    expect(md).toContain('语音');
    expect(md).toContain('文字');
    expect(md).toContain('09:31');
  });

  it('被打断的轮次有标记', () => {
    const s = snap();
    s.rounds[0]!.interrupted = true;
    const md = toMarkdown(s);
    expect(md).toContain('被打断');
  });

  it('没有报告时导出不抛错，写明报告未生成', () => {
    const md = toMarkdown(snap());
    expect(md).toContain('评价报告尚未生成');
  });

  it('有报告时输出总分与各维度', () => {
    const md = toMarkdown(snap({ report: REPORT }));
    expect(md).toContain('72 / 100');
    expect(md).toContain('技术深度');
    expect(md).toContain('需要提高');
    expect(md).toContain('回答先给结论');
  });

  it('降级报告有标注', () => {
    const md = toMarkdown(snap({ report: { ...REPORT, fallback: true } }));
    expect(md).toContain('降级');
  });

  it('没有轮次也不崩', () => {
    const md = toMarkdown(snap({ rounds: [], askedTotal: 0 }));
    expect(md).toContain('没有记录到有效的问答轮次');
  });

  it('元信息包含方向、氛围与计划时长', () => {
    const md = toMarkdown(snap());
    expect(md).toContain('前端转 Agent 开发');
    expect(md).toContain('标准');
    expect(md).toContain('25 分钟');
  });
});

describe('toJson', () => {
  it('可被 JSON.parse 且含 rounds 与 report', () => {
    const o = JSON.parse(toJson(snap({ report: REPORT })));
    expect(o.rounds).toHaveLength(2);
    expect(o.report.total).toBe(72);
    expect(o.meta.track).toBe('frontend-to-agent');
  });

  it('没有报告时 report 为 null', () => {
    const o = JSON.parse(toJson(snap()));
    expect(o.report).toBeNull();
  });
});

describe('exportFileName', () => {
  it('文件名含方向 slug 与日期', () => {
    expect(exportFileName(snap(), new Date('2026-11-04T10:00:00'))).toEqual({
      md: 'interview-2026-11-04-frontend-to-agent.md',
      json: 'interview-2026-11-04-frontend-to-agent.json',
    });
  });
});