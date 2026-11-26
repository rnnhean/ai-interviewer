import { describe, expect, it } from 'vitest';
import { ASR_FRAME_BYTES, buildAsrUrl, TencentAsrSession, type WsLike } from './tencent-asr.client';

const fixed = {
  appId: '1312591814',
  secretId: 'AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  secretKey: 'secret-key-for-test-only',
  voiceId: 'v1',
};

/** 假的 ws：记录发出去的音频长度，可以手动推上游消息 */
function fakeWs(onSend?: (payload: Buffer) => void) {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const sent: string[] = [];
  const ws = {
    send(data: Buffer | string) {
      if (typeof data === 'string') {
        sent.push(data);
        return;
      }
      // 前 4 字节是帧头，音频部分是剩下的
      onSend?.(data.subarray(4));
    },
    close() {
      listeners.close?.forEach((cb) => cb());
    },
    on(event: string, cb: (arg?: unknown) => void) {
      (listeners[event] ??= []).push(cb);
    },
  } as unknown as WsLike;
  return {
    ws,
    sent,
    emit(obj: unknown) {
      listeners.message?.forEach((cb) => cb(Buffer.from(JSON.stringify(obj))));
    },
  };
}

describe('buildAsrUrl', () => {
  it('相同入参生成完全相同的签名 URL', () => {
    const a = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42 });
    const b = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42 });
    expect(a).toBe(b);
    expect(a.startsWith('wss://asr.cloud.tencent.com/asr/v2/1312591814?')).toBe(true);
    expect(a).toContain('signature=');
  });

  it('参数按字母序拼接，voice_id 变化则签名变化', () => {
    const a = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42, voiceId: 'v1' });
    const b = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42, voiceId: 'v2' });
    expect(a).not.toBe(b);
    expect(a).toContain('engine_model_type=16k_zh');
  });

  it('签名里不含 secretKey 明文', () => {
    const url = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42 });
    expect(url).not.toContain(fixed.secretKey);
  });
});

describe('TencentAsrSession', () => {
  it('push 按 1280 字节切帧，尾巴留到下一次', () => {
    const lens: number[] = [];
    const { ws } = fakeWs((p) => lens.push(p.length));
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws });
    s.push(Buffer.alloc(3000));
    expect(lens).toEqual([ASR_FRAME_BYTES, ASR_FRAME_BYTES]);
    expect(ASR_FRAME_BYTES).toBe(1280);
  });

  it('end 会把不足一帧的尾巴发出去', async () => {
    const lens: number[] = [];
    const { ws, emit } = fakeWs((p) => lens.push(p.length));
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws });
    s.push(Buffer.alloc(3000));
    const done = s.end();
    expect(lens).toEqual([1280, 1280, 440]);
    emit({ result: { slice_type: 2, voice_text_str: '我做过知识库项目' } });
    await expect(done).resolves.toBe('我做过知识库项目');
  });

  it('slice_type=1 的中间结果走 onPartial，不影响终稿', async () => {
    const partials: string[] = [];
    const { ws, emit } = fakeWs();
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws, onPartial: (t) => partials.push(t) });
    const done = s.end();
    emit({ result: { slice_type: 1, voice_text_str: '我做过' } });
    emit({ result: { slice_type: 1, voice_text_str: '我做过知识库' } });
    emit({ result: { slice_type: 2, voice_text_str: '我做过知识库项目' } });
    expect(partials).toEqual(['我做过', '我做过知识库']);
    await expect(done).resolves.toBe('我做过知识库项目');
  });

  it('腾讯返回错误码时 end() 给空串而不是 reject', async () => {
    const { ws, emit } = fakeWs();
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws });
    const done = s.end();
    emit({ code: 4004, message: 'bad request' });
    await expect(done).resolves.toBe('');
  });

  it('上游消息不是合法 JSON 时忽略，不抛出', async () => {
    const { ws, emit } = fakeWs();
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws, endTimeoutMs: 50 });
    const done = s.end();
    expect(() => emit('这不是 JSON'.slice(0, 1))).not.toThrow();
    await expect(done).resolves.toBe('');
  });

  it('上游一直不回时按超时给空串', async () => {
    const { ws } = fakeWs();
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws, endTimeoutMs: 30 });
    const t0 = Date.now();
    await expect(s.end()).resolves.toBe('');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('end 之后 push 被忽略', async () => {
    const lens: number[] = [];
    const { ws, emit } = fakeWs((p) => lens.push(p.length));
    const s = new TencentAsrSession({ ...fixed, wsFactory: () => ws });
    const done = s.end();
    emit({ result: { slice_type: 2, voice_text_str: '完' } });
    await done;
    const before = lens.length;
    s.push(Buffer.alloc(2560));
    expect(lens.length).toBe(before);
  });
});