import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { TtsService, type TtsEngine, type TtsMessage } from './tts.service';

function fakeEngine(chunks: string[] = ['a', 'b']): TtsEngine {
  return {
    synthesize: () => Readable.from(chunks.map((c) => Buffer.from(c))),
    dispose: vi.fn(),
  };
}

function harness(engine: TtsEngine = fakeEngine()) {
  const messages: TtsMessage[] = [];
  const audio: string[] = [];
  const transport = {
    sendJson: (_s: string, m: TtsMessage) => messages.push(m),
    sendAudio: (_s: string, b: Buffer) => audio.push(b.toString()),
  };
  const svc = new TtsService(transport, async () => engine);
  return { svc, messages, audio, engine };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('TtsService', () => {
  it('按顺序发送 tts_start、音频、seg_done', async () => {
    const { svc, messages, audio } = harness();
    svc.speak('s1', 't1', '第一句。');
    svc.finishTurn('s1', 't1');
    await settle();

    expect(messages.map((m) => m.type)).toEqual(['tts_start', 'tts_seg_done', 'tts_done']);
    expect(audio.join('')).toBe('ab');
  });

  it('多句按调用顺序合成', async () => {
    const order: string[] = [];
    const engine: TtsEngine = {
      synthesize: (text: string) => {
        order.push(text);
        return Readable.from([Buffer.from('.')]);
      },
      dispose: vi.fn(),
    };
    const { svc } = harness(engine);
    svc.speak('s1', 't1', '一。');
    svc.speak('s1', 't1', '二。');
    await settle();
    expect(order).toEqual(['一。', '二。']);
  });

  it('abort 之后不再推送该轮音频', async () => {
    const { svc, messages, audio } = harness();
    svc.speak('s1', 't1', '第一句。');
    svc.abortTurn('s1', 't1');
    svc.speak('s1', 't1', '第二句。');
    await settle();

    expect(messages.some((m) => m.type === 'tts_abort')).toBe(true);
    expect(audio).toHaveLength(0);
    expect(messages.some((m) => m.type === 'tts_seg_done')).toBe(false);
  });

  it('引擎失败时发 tts_error 且不抛错', async () => {
    const engine: TtsEngine = {
      synthesize: () => {
        throw new Error('boom');
      },
      dispose: vi.fn(),
    };
    const { svc, messages } = harness(engine);
    svc.speak('s1', 't1', '一句。');
    svc.finishTurn('s1', 't1');
    await settle();

    const err = messages.find((m) => m.type === 'tts_error');
    expect(err).toMatchObject({ type: 'tts_error', turnId: 't1' });
    expect(messages.some((m) => m.type === 'tts_done')).toBe(true);
  });

  it('abortTurn 对未知轮次无副作用', () => {
    const { svc, messages } = harness();
    expect(() => svc.abortTurn('nope', 't1')).not.toThrow();
    expect(messages).toHaveLength(0);
  });

  it('新的一轮开始会自动停掉上一轮', async () => {
    const { svc, messages } = harness();
    svc.speak('s1', 't1', '第一轮。');
    svc.speak('s1', 't2', '第二轮。');
    svc.finishTurn('s1', 't2');
    await settle();

    const starts = messages.filter((m) => m.type === 'tts_start');
    expect(starts.map((m) => (m as { turnId: string }).turnId)).toContain('t2');
  });

  it('finishTurn 会释放引擎', async () => {
    const engine = fakeEngine();
    const { svc } = harness(engine);
    svc.speak('s1', 't1', '一句。');
    svc.finishTurn('s1', 't1');
    await settle();
    expect(engine.dispose).toHaveBeenCalled();
  });
});