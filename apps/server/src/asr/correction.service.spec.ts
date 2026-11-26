import { describe, expect, it, vi } from 'vitest';
import { CorrectionService, pcm16ToWav } from './correction.service';

const base = { apiKey: 'test-key', model: 'qwen3-asr-flash', endpoint: 'https://example.test/asr' };

describe('pcm16ToWav', () => {
  it('wav 头长度与关键字段正确', () => {
    const wav = pcm16ToWav(Buffer.alloc(3200));
    expect(wav.length).toBe(44 + 3200);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(4)).toBe(36 + 3200);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
  });
});

describe('CorrectionService', () => {
  it('正常返回识别文本', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ output: { choices: [{ message: { content: [{ text: '我做过知识库项目' }] } }] } }),
        { status: 200 },
      ),
    );
    const svc = new CorrectionService({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(svc.transcribe(Buffer.alloc(6400))).resolves.toBe('我做过知识库项目');
  });

  it('请求体用的是 data:audio/wav;base64 与配置的模型', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ output: { choices: [] } }), { status: 200 });
    });
    const svc = new CorrectionService({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.transcribe(Buffer.alloc(6400));

    const body = JSON.parse(String(captured!.init.body)) as {
      model: string;
      input: { messages: Array<{ content: Array<{ audio: string }> }> };
    };
    expect(body.model).toBe('qwen3-asr-flash');
    expect(body.input.messages[0]!.content[0]!.audio.startsWith('data:audio/wav;base64,')).toBe(true);
    // 凭据只出现在 Authorization 头里，不进 body、不进日志
    expect(String(captured!.init.body)).not.toContain('test-key');
  });

  it('识别失败返回 null，不抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 }));
    const svc = new CorrectionService({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(svc.transcribe(Buffer.alloc(6400))).resolves.toBeNull();
  });

  it('网络异常返回 null', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const svc = new CorrectionService({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(svc.transcribe(Buffer.alloc(6400))).resolves.toBeNull();
  });

  it('音频太短直接返回 null，不发起请求', async () => {
    const fetchImpl = vi.fn();
    const svc = new CorrectionService({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(svc.transcribe(Buffer.alloc(100))).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});