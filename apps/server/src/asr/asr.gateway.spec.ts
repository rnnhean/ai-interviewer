import { describe, expect, it, vi } from 'vitest';
import type { AsrServerMessage } from '@ai-interviewer/shared';
import { AsrConnection, MOCK_SCRIPT, type AsrDeps, type AsrUpstream } from './asr.gateway';

function harness(overrides: Partial<AsrDeps> = {}) {
  const sent: AsrServerMessage[] = [];
  const created: string[] = [];
  const deps: AsrDeps = {
    mode: 'mock',
    createUpstream: () => {
      created.push('upstream');
      return null;
    },
    correct: async () => null,
    normalize: async (t) => t,
    ...overrides,
  };
  const conn = new AsrConnection((m) => sent.push(m), deps);
  return { conn, sent, created };
}

describe('AsrConnection', () => {
  it('连上先发 asr_ready 带模式', () => {
    const { sent } = harness();
    expect(sent[0]).toEqual({ type: 'asr_ready', mode: 'mock' });
  });

  it('mock 模式不创建上游连接', () => {
    const { conn, created } = harness();
    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    expect(created).toHaveLength(0);
  });

  it('mock：partial 逐字增长，final 是完整句子', async () => {
    const { conn, sent } = harness();
    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleAudio(Buffer.alloc(16_000));
    conn.handleAudio(Buffer.alloc(16_000));

    const partials = sent.filter((m) => m.type === 'asr_partial');
    expect(partials.length).toBeGreaterThan(0);
    const texts = partials.map((m) => (m as { text: string }).text);
    for (let i = 1; i < texts.length; i += 1) {
      expect(texts[i]!.length).toBeGreaterThan(texts[i - 1]!.length);
    }

    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 10));

    const final = sent.find((m) => m.type === 'asr_final');
    expect(final).toEqual({ type: 'asr_final', voiceId: 'v1', text: MOCK_SCRIPT });
  });

  it('live：上游 partial 转成 asr_partial，终稿不被打断覆盖', async () => {
    let onPartial: (t: string) => void = () => undefined;
    const upstream: AsrUpstream = {
      push: vi.fn(),
      end: async () => '我做过知识库项目',
      close: vi.fn(),
    };
    const { conn, sent } = harness({
      mode: 'live',
      createUpstream: (cb) => {
        onPartial = cb;
        return upstream;
      },
    });

    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    onPartial('我做过');
    onPartial('我做过知识库');
    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 10));

    expect(sent.filter((m) => m.type === 'asr_partial').map((m) => (m as { text: string }).text)).toEqual([
      '我做过',
      '我做过知识库',
    ]);
    expect(sent.find((m) => m.type === 'asr_final')).toMatchObject({ text: '我做过知识库项目' });
  });

  it('终稿校正的结果覆盖流式结果', async () => {
    const upstream: AsrUpstream = { push: vi.fn(), end: async () => '流式结果', close: vi.fn() };
    const { conn, sent } = harness({
      mode: 'live',
      createUpstream: () => upstream,
      correct: async () => '校正后的结果',
    });

    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleAudio(Buffer.alloc(6400));
    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 20));

    expect(sent.find((m) => m.type === 'asr_final')).toMatchObject({ text: '校正后的结果' });
  });

  it('校正失败时保留流式结果', async () => {
    const upstream: AsrUpstream = { push: vi.fn(), end: async () => '流式结果', close: vi.fn() };
    const { conn, sent } = harness({ mode: 'live', createUpstream: () => upstream, correct: async () => null });

    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleAudio(Buffer.alloc(6400));
    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 20));

    expect(sent.find((m) => m.type === 'asr_final')).toMatchObject({ text: '流式结果' });
  });

  it('上游不可用时推 asr_error 且不抛错', () => {
    const { conn, sent } = harness({ mode: 'live', createUpstream: () => null });
    expect(() => conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }))).not.toThrow();
    expect(sent.some((m) => m.type === 'asr_error')).toBe(true);
  });

  it('识别为空时推 asr_error 而不是空 final', async () => {
    const upstream: AsrUpstream = { push: vi.fn(), end: async () => '', close: vi.fn() };
    const { conn, sent } = harness({ mode: 'live', createUpstream: () => upstream });

    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 20));

    expect(sent.some((m) => m.type === 'asr_final')).toBe(false);
    expect(sent.some((m) => m.type === 'asr_error')).toBe(true);
  });

  it('术语纠正有变化时补一条 asr_normalized', async () => {
    const { conn, sent } = harness({
      mode: 'mock',
      normalize: async (t) => t.replace('NestJS', 'Nest.js'),
    });
    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 20));

    expect(sent.find((m) => m.type === 'asr_normalized')).toMatchObject({ text: MOCK_SCRIPT.replace('NestJS', 'Nest.js') });
  });

  it('同一 voiceId 重复 start 幂等', () => {
    let count = 0;
    const { conn } = harness({
      mode: 'live',
      createUpstream: () => {
        count += 1;
        return { push: vi.fn(), end: async () => '', close: vi.fn() };
      },
    });
    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    expect(count).toBe(1);
  });

  it('cancelled 之后音频与终稿都不再产生', async () => {
    const { conn, sent } = harness();
    conn.handleJson(JSON.stringify({ type: 'utterance_start', voiceId: 'v1' }));
    conn.handleAudio(Buffer.alloc(16_000));
    conn.handleJson(JSON.stringify({ type: 'utterance_cancel', voiceId: 'v1' }));
    const before = sent.length;
    conn.handleAudio(Buffer.alloc(16_000));
    conn.handleJson(JSON.stringify({ type: 'utterance_end', voiceId: 'v1' }));
    await new Promise((r) => setTimeout(r, 10));

    expect(sent.length).toBe(before);
  });

  it('非法 JSON 帧被忽略', () => {
    const { conn, sent } = harness();
    const before = sent.length;
    expect(() => conn.handleJson('not json')).not.toThrow();
    expect(sent.length).toBe(before);
  });
});