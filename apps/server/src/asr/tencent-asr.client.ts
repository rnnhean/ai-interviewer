import { createHmac } from 'node:crypto';

/** 腾讯实时语音识别每帧 640 采样 / 16bit = 1280 字节（40ms） */
export const ASR_FRAME_BYTES = 1280;

export interface AsrUrlOptions {
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType?: string;
  voiceId: string;
  /** 秒级时间戳，测试时固定 */
  now?: number;
  nonce?: number;
}

/**
 * 生成腾讯云一句话/实时语音识别的 WS 签名 URL。
 * 参数名大小写、排序、签名串拼接方式都必须与官方一致，改一个字符就签不过。
 */
export function buildAsrUrl(opts: AsrUrlOptions): string {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? Math.floor(Math.random() * 1e9);

  const params: Record<string, string | number> = {
    secretid: opts.secretId,
    timestamp: now,
    expired: now + 86400,
    nonce,
    engine_model_type: opts.engineModelType ?? '16k_zh',
    voice_format: 1,
    voice_id: opts.voiceId,
    needvad: 1,
    filter_dirty: 0,
    filter_modal: 0,
    filter_punc: 0,
    convert_num_mode: 1,
    word_info: 0,
  };

  const signStr = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  const origin = `asr.cloud.tencent.com/asr/v2/${opts.appId}?${signStr}`;
  const signature = createHmac('sha1', opts.secretKey).update(origin).digest('base64');

  return `wss://${origin}&signature=${encodeURIComponent(signature)}`;
}

/** 只依赖 ws 的最小接口，方便测试注入假连接 */
export interface WsLike {
  send(data: Buffer | string): void;
  close(): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'open', cb: () => void): void;
}

export type WsFactory = (url: string) => WsLike;

export interface TencentAsrOptions {
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType?: string;
  wsFactory: WsFactory;
  /** 每识别出一段中间结果就回调；不改终稿 */
  onPartial?: (text: string) => void;
  /** 等终稿的最长时间，超时按空串处理，避免一句话把网关挂死 */
  endTimeoutMs?: number;
}

interface AsrUpstreamMessage {
  code?: number;
  message?: string;
  result?: {
    slice_type?: number;
    index?: number;
    voice_text_str?: string;
    start_time?: number;
  };
}

/**
 * 一次「按住说话」的上游会话：PCM 按 1280 字节分帧推上去，
 * 收到 slice_type=2 时拿到终稿。
 */
export class TencentAsrSession {
  private readonly voiceId: string;
  private buffer: Buffer = Buffer.alloc(0);
  private finalText = '';
  private closed = false;
  private readonly finished: Promise<string>;
  private resolveFinished!: (text: string) => void;

  constructor(private readonly opts: TencentAsrOptions) {
    this.voiceId = `voice-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });

    const ws = opts.wsFactory(
      buildAsrUrl({
        appId: opts.appId,
        secretId: opts.secretId,
        secretKey: opts.secretKey,
        engineModelType: opts.engineModelType,
        voiceId: this.voiceId,
      }),
    );
    this.ws = ws;

    ws.on('message', (data: unknown) => this.onMessage(data));
    ws.on('error', () => this.finish(''));
    ws.on('close', () => this.finish(''));
  }

  private readonly ws: WsLike;

  /** 推一段 PCM（16k / 16bit / 单声道）。不足一帧的尾巴留到下次 */
  push(pcm: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length === 0 ? pcm : Buffer.concat([this.buffer, pcm]);

    while (this.buffer.length >= ASR_FRAME_BYTES) {
      const frame = this.buffer.subarray(0, ASR_FRAME_BYTES);
      this.buffer = this.buffer.subarray(ASR_FRAME_BYTES);
      this.send(frame);
    }
  }

  /** 结束这句话：把余下的尾巴发出去，等终稿。失败时给空串 */
  async end(): Promise<string> {
    if (!this.closed && this.buffer.length > 0) {
      this.send(this.buffer);
      this.buffer = Buffer.alloc(0);
    }
    if (!this.closed) {
      try {
        // 腾讯云约定：文本帧 {"type":"end"} 表示这句话说完了，服务端回 slice_type=2
        this.ws.send('{"type":"end"}');
      } catch {
        this.finish('');
      }
    }

    const timeout = this.opts.endTimeoutMs ?? 5000;
    return Promise.race([
      this.finished,
      new Promise<string>((resolve) => {
        setTimeout(() => {
          this.finish(this.finalText);
          resolve(this.finalText);
        }, timeout).unref?.();
      }),
    ]);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* 已关闭 */
    }
    this.finish(this.finalText);
  }

  private send(frame: Buffer): void {
    try {
      // 腾讯要求每帧前 4 字节为 metadata：版本/头长/消息类型/压缩位（全部为 0）
      const header = Buffer.alloc(4);
      this.ws.send(Buffer.concat([header, frame]));
    } catch {
      this.finish('');
    }
  }

  private onMessage(data: unknown): void {
    const text = toText(data);
    if (text === null) return;

    let msg: AsrUpstreamMessage;
    try {
      msg = JSON.parse(text) as AsrUpstreamMessage;
    } catch {
      return;
    }

    if (typeof msg.code === 'number' && msg.code !== 0) {
      this.finish('');
      return;
    }

    const result = msg.result;
    if (!result) return;

    const piece = (result.voice_text_str ?? '').trim();
    if (result.slice_type === 2) {
      this.finalText = piece;
      this.finish(piece);
      return;
    }

    if (piece !== '') this.opts.onPartial?.(piece);
  }

  private finish(text: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.resolveFinished(text);
  }
}

function toText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return null;
}