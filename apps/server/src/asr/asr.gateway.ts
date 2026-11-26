import type { AsrClientMessage, AsrServerMessage } from '@ai-interviewer/shared';
import { parseWsJson } from '@ai-interviewer/shared';

/** mock 模式下固定输出的句子，和真实识别结果格式一致 */
export const MOCK_SCRIPT = '我做过一个基于 React 和 NestJS 的知识库项目';

/** mock 模式下多少字节算出「说完整句」：16k*16bit 单声道约 32KB/s，2 秒 */
const MOCK_FULL_BYTES = 64_000;

/** 上游识别会话的最小接口（真实实现是 TencentAsrSession） */
export interface AsrUpstream {
  push(pcm: Buffer): void;
  end(): Promise<string>;
  close(): void;
}

export interface AsrDeps {
  mode: 'mock' | 'live';
  /** live 模式建上游；建不出来返回 null，前端会收到 asr_error */
  createUpstream(onPartial: (text: string) => void): AsrUpstream | null;
  /** 整句终稿校正，失败给 null */
  correct(pcm: Buffer): Promise<string | null>;
  /** 术语归一，失败给原文 */
  normalize(text: string): Promise<string>;
}

interface ActiveUtterance {
  voiceId: string;
  upstream: AsrUpstream | null;
  chunks: Buffer[];
  bytes: number;
  sentChars: number;
  cancelled: boolean;
}

/**
 * 一条 /ws/asr 连接上的全部状态机。
 * 纯逻辑实现，socket 只负责把 send 出去的字符串/二进制帧写到客户端。
 */
export class AsrConnection {
  private active: ActiveUtterance | null = null;

  constructor(
    private readonly send: (msg: AsrServerMessage) => void,
    private readonly deps: AsrDeps,
  ) {
    this.send({ type: 'asr_ready', mode: deps.mode });
  }

  /** 文本帧：一句话的开始 / 结束 / 取消 */
  handleJson(raw: string): void {
    const msg = parseWsJson<AsrClientMessage>(raw);
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'utterance_start':
        this.start(typeof msg.voiceId === 'string' ? msg.voiceId : 'v');
        break;
      case 'utterance_end':
        void this.end();
        break;
      case 'utterance_cancel':
        this.cancel();
        break;
      default:
        break;
    }
  }

  /** 二进制帧：PCM 片段 */
  handleAudio(pcm: Buffer): void {
    const a = this.active;
    if (!a || a.cancelled) return;

    a.chunks.push(pcm);
    a.bytes += pcm.length;

    if (a.upstream) {
      a.upstream.push(pcm);
      return;
    }

    // mock：按收到的音频量把预置句子逐字吐出来
    const ratio = Math.min(1, a.bytes / MOCK_FULL_BYTES);
    const chars = Math.floor(ratio * MOCK_SCRIPT.length);
    if (chars > a.sentChars) {
      a.sentChars = chars;
      this.send({ type: 'asr_partial', voiceId: a.voiceId, text: MOCK_SCRIPT.slice(0, chars) });
    }
  }

  /** 连接关闭：停掉上游，不再回任何消息 */
  dispose(): void {
    if (this.active) {
      this.active.cancelled = true;
      this.active.upstream?.close();
      this.active = null;
    }
  }

  private start(voiceId: string): void {
    // 同一 voiceId 重复 start 幂等：保留原来的上游，不重开
    if (this.active && this.active.voiceId === voiceId) return;

    this.dispose();

    const active: ActiveUtterance = {
      voiceId,
      upstream: null,
      chunks: [],
      bytes: 0,
      sentChars: 0,
      cancelled: false,
    };
    this.active = active;

    if (this.deps.mode === 'mock') return;

    const upstream = this.deps.createUpstream((text) => {
      if (active.cancelled || this.active !== active) return;
      this.send({ type: 'asr_partial', voiceId, text });
    });
    if (!upstream) {
      this.send({ type: 'asr_error', voiceId, message: '语音识别不可用，请改用文字输入' });
      return;
    }
    active.upstream = upstream;
  }

  private async end(): Promise<void> {
    const a = this.active;
    if (!a || a.cancelled) return;
    this.active = null;

    const pcm = Buffer.concat(a.chunks);
    let final = '';

    if (a.upstream) {
      final = await a.upstream.end();
    } else {
      final = MOCK_SCRIPT;
    }

    // 整句终稿校正：音频够长时才值得多花一次请求
    if (pcm.length >= 3200) {
      const corrected = await this.deps.correct(pcm);
      if (corrected !== null && corrected !== '') final = corrected;
    }

    final = final.trim();
    if (final === '') {
      this.send({ type: 'asr_error', voiceId: a.voiceId, message: '没听清，再说一次？' });
      return;
    }

    this.send({ type: 'asr_final', voiceId: a.voiceId, text: final });

    const normalized = (await this.deps.normalize(final)).trim();
    if (normalized !== '' && normalized !== final) {
      this.send({ type: 'asr_normalized', voiceId: a.voiceId, text: normalized });
    }
  }

  private cancel(): void {
    const a = this.active;
    if (!a) return;
    a.cancelled = true;
    a.upstream?.close();
    this.active = null;
  }
}