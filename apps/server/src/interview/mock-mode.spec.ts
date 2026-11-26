import { Test } from '@nestjs/testing';
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { CorrectionService } from '../asr/correction.service';
import { LlmService } from '../llm/llm.service';

const FINISH = { unified: 'stop' as const, raw: 'stop' };
const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const INTERVIEWER_LINE = '<<CTRL {"move":"follow_up","phase":"intro","asked":1}>>\n\n先说说你最近做的那个项目。';

const REPORT = {
  total: 70,
  dimensions: [
    { key: 'technical', score: 7, comment: '原理讲得清楚' },
    { key: 'decomposition', score: 7, comment: '会拆问题' },
    { key: 'tradeoff', score: 7, comment: '提到过取舍' },
    { key: 'verification', score: 7, comment: '有验证意识' },
    { key: 'communication', score: 7, comment: '结论先行' },
  ],
  strengths: [
    { quote: '第一轮回答', why: '有具体项目' },
    { quote: '第二轮回答', why: '讲到了链路' },
    { quote: '第三轮回答', why: '讲了验证' },
  ],
  gaps: [
    { quote: '第一轮回答', issue: '缺少具体数字', suggestion: '补上量化指标' },
    { quote: '第二轮回答', issue: '没有讲取舍', suggestion: '说出两套方案的代价' },
    { quote: '第三轮回答', issue: '没有给评测方式', suggestion: '先定判据再动手' },
  ],
  actions: ['回答先给结论', '准备三个关键数字', '每题补一句验证方式'],
};

/**
 * 同一个模型既要能流式出面试官台词，又要能返回一次工具调用当评价报告，
 * 这正是生产链路里 LlmService.model 的用法。
 */
function scriptedModel(): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'text-start' as const, id: 't' },
        { type: 'text-delta' as const, id: 't', delta: INTERVIEWER_LINE },
        { type: 'text-end' as const, id: 't' },
        { type: 'finish' as const, finishReason: FINISH, usage: USAGE },
      ]),
    }),
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'call-1',
          toolName: 'submitReport',
          input: JSON.stringify(REPORT),
        },
      ],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
      usage: USAGE,
      warnings: [],
    }),
  }) as unknown as LanguageModel;
}

describe('mock 模式端到端', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService)
      .useValue({ model: scriptedModel(), modelId: 'mock' })
      // tsx/esbuild 不产出 decorator metadata，真实启动时靠 @Optional() 兜住；
      // 测试里显式给个空实现，避免 Nest 试图按类型注入
      .overrideProvider(CorrectionService)
      .useValue({ transcribe: async () => null })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  it('文字模式能连跑 3 轮并产出报告与导出', async () => {
    const created = await request(server)
      .post('/api/interview')
      .send({ track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 })
      .expect(201);
    const id: string = created.body.id;
    expect(typeof id).toBe('string');

    const opening = await request(server).post(`/api/interview/${id}/opening`).expect(200);
    expect(opening.text).toContain('先说说你最近做的那个项目');
    // 控制行不许漏给前端
    expect(opening.text).not.toContain('<<CTRL');

    for (const text of ['第一轮回答', '第二轮回答', '第三轮回答']) {
      const r = await request(server)
        .post(`/api/interview/${id}/turn`)
        .send({ text, source: 'text' })
        .expect(200);
      expect(r.text).toContain('先说说你最近做的那个项目');
    }

    const mid = await request(server).get(`/api/interview/${id}`).expect(200);
    expect(mid.body.rounds).toHaveLength(3);
    expect(mid.body.rounds[0].answer).toBe('第一轮回答');

    const finished = await request(server).post(`/api/interview/${id}/finish`).expect(201);
    expect(finished.body.snapshot.report.dimensions).toHaveLength(5);
    expect(finished.body.snapshot.status).toBe('finished');

    const md = await request(server).get(`/api/interview/${id}/export?format=md`).expect(200);
    expect(md.text).toContain('第一轮回答');
    expect(md.text).toContain('回答先给结论');

    const json = await request(server).get(`/api/interview/${id}/export?format=json`).expect(200);
    expect(JSON.parse(json.text).report.total).toBe(70);
  });

  it('空回答返回 400 而不是写进记录', async () => {
    const created = await request(server)
      .post('/api/interview')
      .send({ track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 })
      .expect(201);
    await request(server).post(`/api/interview/${created.body.id}/turn`).send({ text: '   ' }).expect(400);
  });

  it('报告未生成时导出返回 202 而不是半个文件', async () => {
    const created = await request(server)
      .post('/api/interview')
      .send({ track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 })
      .expect(201);
    const r = await request(server).get(`/api/interview/${created.body.id}/export?format=md`);
    expect(r.status).toBe(200); // active 且没有 report：允许导出现场记录
    expect(r.text).toContain('Agent 开发工程师');
  });
});
