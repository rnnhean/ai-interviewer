import { Injectable } from '@nestjs/common';
import { getEnv } from '../config/config.module';

const DEFAULT_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/** 把 16k / 16bit / 单声道 PCM 包成 WAV，给只收音频文件的接口用 */
export function pcm16ToWav(pcm: Buffer, sampleRate = 16000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt 块长度
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export interface CorrectionOptions {
  apiKey: string;
  model: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 一句话的终稿校正：把整段 PCM 交给 qwen3-asr-flash 重新识别。
 * 腾讯的流式结果用来做实时字幕，这句用来定稿；失败就返回 null，调用方用流式结果兜底。
 */
@Injectable()
export class CorrectionService {
  private readonly opts: CorrectionOptions;

  constructor(opts?: Partial<CorrectionOptions>) {
    const env = getEnv();
    this.opts = {
      apiKey: opts?.apiKey ?? env.llmApiKey,
      model: opts?.model ?? env.asrCorrectionModel,
      endpoint: opts?.endpoint ?? DEFAULT_ENDPOINT,
      timeoutMs: opts?.timeoutMs ?? 5000,
      fetchImpl: opts?.fetchImpl ?? fetch,
    };
  }

  async transcribe(pcm: Buffer): Promise<string | null> {
    if (pcm.length < 3200) return null; // 少于 0.1 秒没有意义

    const wav = pcm16ToWav(pcm);
    const body = {
      model: this.opts.model,
      input: {
        messages: [
          { role: 'user', content: [{ audio: `data:audio/wav;base64,${wav.toString('base64')}` }] },
        ],
      },
      parameters: { asr_options: { language: 'zh' } },
    };

    try {
      const res = await this.opts.fetchImpl!(this.opts.endpoint!, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs!),
      });
      if (!res.ok) return null;

      const json = (await res.json()) as {
        output?: { choices?: Array<{ message?: { content?: Array<{ text?: string }> } }> };
      };
      const text = json.output?.choices?.[0]?.message?.content?.[0]?.text ?? '';
      const trimmed = text.trim();
      return trimmed === '' ? null : trimmed;
    } catch {
      return null;
    }
  }
}