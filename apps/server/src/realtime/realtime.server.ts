import { Inject, Injectable } from '@nestjs/common';
import { WebSocket, WebSocketServer } from 'ws';
import type { AsrServerMessage, TtsClientMessage } from '@ai-interviewer/shared';
import { parseWsJson } from '@ai-interviewer/shared';
import { getEnv } from '../config/config.module';
import { AsrConnection, type AsrDeps, type AsrUpstream } from '../asr/asr.gateway';
import { CorrectionService } from '../asr/correction.service';
import { TermNormalizer } from '../asr/normalizer.service';
import { TencentAsrSession } from '../asr/tencent-asr.client';
import { InterviewService } from '../interview/session.store';
import type { SocketLike } from '../tts/tts.hub';
import { TtsHub } from '../tts/tts.hub';
import { heartbeat } from './heartbeat';
import { TtsService } from '../tts/tts.service';

export interface UpgradeContext {
  pathname: string;
  url: URL;
  socket: WebSocket;
}

/**
 * 把两条 WS 通道挂到 Nest 的 http server 上：
 * - /ws/tts?session=<id>：面试官语音
 * - /ws/asr?session=<id>：候选人麦克风，PCM 二进制帧 + 起止文本帧
 */
@Injectable()
export class RealtimeServer {
  private wss?: WebSocketServer;

  constructor(
    @Inject(TtsHub) private readonly hub: TtsHub,
    @Inject(TtsService) private readonly tts: TtsService,
    @Inject(InterviewService) private readonly interviews: InterviewService,
    @Inject(CorrectionService) private readonly correction: CorrectionService,
    @Inject(TermNormalizer) private readonly normalizer: TermNormalizer,
  ) {}

  attach(server: import('node:http').Server): void {
    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    server.on('upgrade', (req, socket, head) => {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.handleUpgrade({ pathname: url.pathname, url, socket: ws }));
    });
  }

  handleUpgrade({ pathname, url, socket }: UpgradeContext): void {
    const sessionId = url.searchParams.get('session') ?? '';

    if (pathname === '/ws/tts') {
      this.openTts(sessionId, socket);
      return;
    }
    if (pathname === '/ws/asr') {
      this.openAsr(sessionId, socket);
      return;
    }
    socket.close(1008, 'unknown endpoint');
  }

  close(): void {
    this.wss?.close();
    this.wss = undefined;
  }

  private openTts(sessionId: string, socket: WebSocket): void {
    const detach = this.hub.attach(sessionId, socket as unknown as SocketLike);
    const stopHeartbeat = heartbeat(socket);
    socket.on('close', () => {
      stopHeartbeat();
      detach();
    });

    socket.on('message', (data: unknown, isBinary: boolean) => {
      if (isBinary) return;
      const msg = parseWsJson<TtsClientMessage>(toText(data) ?? '');
      if (!msg) return;
      if (msg.type === 'barge_in') {
        this.interviews.interrupt(sessionId);
        this.tts.abortTurn(sessionId, msg.turnId);
      }
    });
  }

  private openAsr(sessionId: string, socket: WebSocket): void {
    const deps = this.asrDeps();
    const conn = new AsrConnection((msg: AsrServerMessage) => this.sendJson(socket, msg), deps);
    const stopHeartbeat = heartbeat(socket);

    socket.on('message', (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        const buf = toBuffer(data);
        if (buf) conn.handleAudio(buf);
        return;
      }
      const text = toText(data);
      if (text) conn.handleJson(text);
    });

    socket.on('close', () => {
      stopHeartbeat();
      conn.dispose();
    });
  }

  private asrDeps(): AsrDeps {
    const env = getEnv();
    return {
      mode: env.speechMode,
      createUpstream: (onPartial): AsrUpstream | null => {
        if (!env.tencentSecretId || !env.tencentSecretKey || !env.tencentAppId) return null;
        return new TencentAsrSession({
          appId: env.tencentAppId,
          secretId: env.tencentSecretId,
          secretKey: env.tencentSecretKey,
          engineModelType: env.tencentAsrEngine,
          onPartial,
          wsFactory: (url) => new WebSocket(url) as unknown as import('../asr/tencent-asr.client').WsLike,
        });
      },
      correct: (pcm) => this.correction.transcribe(pcm),
      normalize: (text) => this.normalizer.normalize(text),
    };
  }

  private sendJson(socket: WebSocket, payload: AsrServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* 客户端已断 */
    }
  }
}

function toText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return null;
}

function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  return null;
}