import { describe, expect, it } from 'vitest';
import type { LanguageModel } from 'ai';
import { ReportSchema, type SessionSnapshot } from '@ai-interviewer/shared';
import type { LlmService } from '../llm/llm.service';
import { brokenModel, modelCallingTool } from '../testing/mock-model';
import { ReportService } from './report.service';

const VALID = {
  total: 72,
  dimensions: [
    { key: 'technical', score: 7, comment: '原理讲得清楚，边界略糊' },
    { key: 'decomposition', score: 8, comment: '先拆问题再动手' },
    { key: 'tradeoff', score: 6, comment: '提到了代价但没有量化' },
    { key: 'verification', score: 7, comment: '有写测试的意识' },
    { key: 'communication', score: 7, comment: '结论先行，中间有跑题' },
  ],
  strengths: [
    { quote: '先做粗召回再做 rerank', why: '链路分层清楚' },
    { quote: '我加了一条回归用例', why: '有验证意识' },
    { quote: '我选 Qwen 是因为便宜', why: '考虑过成本' },
  ],
  gaps: [
    { quote: '就是调了个 API', issue: '没有说清楚参数怎么定', suggestion: '说出阈值来源' },
    { quote: '应该没问题', issue: '缺少验证步骤', suggestion: '给出验证方式' },
    { quote: '效果还行', issue: '没有量化', suggestion: '补上数字' },
  ],
  actions: ['回答先给结论再展开两点论据', '给项目准备三个关键数字', '不会的题先说思路'],
};

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: 's1',
    track: 'frontend-to-agent',
    atmosphere: 'standard',
    durationMin: 25,
    phase: 'done',
    askedTotal: 3,
    askedInPhase: 1,
    followUps: 0,
    startedAt: 1762300000000,
    status: 'finished',
    rounds: [
      {
        index: 1,
        question: 'RAG 的召回怎么做？',
        answer: '先做粗召回再做 rerank，用的 bge',
        source: 'voice',
        submittedAt: 1762300060000,
        interrupted: false,
      },
      {
        index: 2,
        question: 'rerank 用什么模型？',
        answer: '用的 bge-reranker',
        source: 'voice',
        submittedAt: 1762300120000,
        interrupted: false,
      },
      {
        index: 3,
        question: '怎么验证效果？',
        answer: '我加了一条回归用例',
        source: 'text',
        submittedAt: 1762300180000,
        interrupted: false,
      },
    ],
    ...overrides,
  };
}

const asLlm = (model: LanguageModel) => ({ model }) as unknown as LlmService;

describe('ReportSchema', () => {
  it('维度必须恰好 5 个', () => {
    expect(() => ReportSchema.parse({ ...VALID, dimensions: [] })).toThrow();
    expect(ReportSchema.parse(VALID).dimensions).toHaveLength(5);
  });

  it('key 非法时报错', () => {
    const bad = structuredClone(VALID);
    bad.dimensions[0]!.key = 'leadership' as never;
    expect(() => ReportSchema.parse(bad)).toThrow();
  });

  it('actions 必须恰好 3 条', () => {
    expect(() => ReportSchema.parse({ ...VALID, actions: ['只有一条动作'] })).toThrow();
  });
});

describe('ReportService.generate', () => {
  it('正常路径返回结构化报告', async () => {
    const svc = new ReportService(asLlm(modelCallingTool('submitReport', VALID)));
    const r = await svc.generate(snapshot());
    expect(r.total).toBe(72);
    expect(r.dimensions).toHaveLength(5);
    expect(r.fallback).toBeUndefined();
  });

  it('维度按固定顺序返回', async () => {
    const shuffled = structuredClone(VALID);
    shuffled.dimensions.reverse();
    const svc = new ReportService(asLlm(modelCallingTool('submitReport', shuffled)));
    const r = await svc.generate(snapshot());
    expect(r.dimensions.map((d) => d.key)).toEqual([
      'technical',
      'decomposition',
      'tradeoff',
      'verification',
      'communication',
    ]);
  });

  it('模型失败时降级报告仍含 5 维与 3 条动作', async () => {
    const svc = new ReportService(asLlm(brokenModel()));
    const r = await svc.generate(snapshot());
    expect(r.dimensions).toHaveLength(5);
    expect(r.actions).toHaveLength(3);
    expect(r.strengths).toHaveLength(3);
    expect(r.gaps).toHaveLength(3);
    expect(r.fallback).toBe(true);
  });

  it('模型返回非法结构时也走降级', async () => {
    const svc = new ReportService(asLlm(modelCallingTool('submitReport', { ...VALID, dimensions: [] })));
    const r = await svc.generate(snapshot());
    expect(r.fallback).toBe(true);
    expect(r.dimensions).toHaveLength(5);
  });
});

describe('ReportService.fallback', () => {
  it('没有有效回答时仍给出完整结构', () => {
    const svc = new ReportService(asLlm(brokenModel()));
    const r = svc.fallback(snapshot({ rounds: [] }));
    expect(r.dimensions).toHaveLength(5);
    expect(r.strengths).toHaveLength(3);
    expect(r.gaps).toHaveLength(3);
    expect(r.actions).toHaveLength(3);
    expect(r.total).toBe(60);
  });

  it('引用的原话截取自真实回答', () => {
    const svc = new ReportService(asLlm(brokenModel()));
    const r = svc.fallback(snapshot());
    expect(r.strengths[0]!.quote).toContain('粗召回');
  });
});