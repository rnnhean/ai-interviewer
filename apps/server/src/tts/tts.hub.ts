import { Injectable } from '@nestjs/common';
import type { TtsServerMessage } from '@ai-interviewer/shared';
import type { TtsTransport } from './tts.service';

/** 和 ws 的 WebSocket 对齐的最小接口，测试时可以塞假的 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string | Buffer): void;
  close(): void;
}

const OPEN = 1;

/** 维护「会话 → 已连接客户端」，TTS 的音频和元信息都经这里出去 */
@Injectable()
export class TtsHub implements TtsTransport {
  private readonly conns = new Map<string, Set<SocketLike>>();

  attach(sessionId: string, socket: SocketLike): () => void {
    const set = this.conns.get(sessionId) ?? new Set<SocketLike>();
    set.add(socket);
    this.conns.set(sessionId, set);

    return () => {
      const current = this.conns.get(sessionId);
      if (!current) return;
      current.delete(socket);
      if (current.size === 0) this.conns.delete(sessionId);
    };
  }

  sendJson(sessionId: string, payload: TtsServerMessage): void {
    const text = JSON.stringify(payload);
    for (const socket of this.conns.get(sessionId) ?? []) {
      if (socket.readyState !== OPEN) continue;
      try {
        socket.send(text);
      } catch {
        /* 客户端已断，忽略 */
      }
    }
  }

  sendAudio(sessionId: string, buf: Buffer): void {
    for (const socket of this.conns.get(sessionId) ?? []) {
      if (socket.readyState !== OPEN) continue;
      try {
        socket.send(buf);
      } catch {
        /* 客户端已断，忽略 */
      }
    }
  }

  count(sessionId: string): number {
    return this.conns.get(sessionId)?.size ?? 0;
  }
}