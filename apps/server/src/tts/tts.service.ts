import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { TtsServerMessage, WordTiming } from '@ai-interviewer/shared';
import { getEnv } from '../config/config.module';
import { TtsHub } from './tts.hub';

/** 服务端 → 客户端的消息（定义在 shared，前端共用） */
export type TtsMessage = TtsServerMessage;

/** 网关注入的发送通道：文本帧发元信息，二进制帧发音频 */
export interface TtsTransport {
  sendJson(sessionId: string, payload: TtsMessage): void;
  sendAudio(sessionId: string, buf: Buffer): void;
}

/** 一个可合成音频的引擎（默认实现是 msedge-tts） */
export interface TtsEngine {
  /** 边合成边吐 MP3 分片 */
  synthesize(text: string): Readable;
  /**
   * 边合成边吐出词级时间戳。有它前端才能把口型对到念出的字上，
   * 没有就只能按音量粗放地开合嘴。
   */
  synthesizeWithTiming?(text: string): { audio: Readable; words: Promise<WordTiming[]> };
  dispose(): void;
}

export type TtsEngineFactory = () => Promise<TtsEngine>;

export interface TtsSink {
  speak(sessionId: string, turnId: string, text: string): void;
  finishTurn(sessionId: string, turnId: string): void;
  abortTurn(sessionId: string, turnId: string): void;
}

interface TurnState {
  turnId: string;
  segId: number;
  aborted: boolean;
  /** 当前正在播的分片流，abort 时要立刻销毁 */
  current?: Readable;
}

const DEFAULT_FACTORY: TtsEngineFactory = async () => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(getEnv().edgeTtsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  });
  return {
    synthesize: (text: string) => tts.toStream(text).audioStream as Readable,
    synthesizeWithTiming: (text: string) => {
      const { audioStream, metadataStream } = tts.toStream(text);
      const words = collectWordBoundaries(metadataStream, audioStream as Readable);
      return { audio: audioStream as Readable, words };
    },
    dispose: () => tts.close(),
  };
};

/**
 * 从 msedge-tts 的 metadata 流里收集词边界。
 *
 * 引擎给的是 100ns 单位的 Offset/Duration，Offset 已经**相对本段音频起点**，
 * 前导静音本来就包含在里面（首条 Offset 恒为 100ms 左右，就是引擎固定的静音）。
 * 所以直接用原始 Offset，**不要再减任何基准**——之前减过一次，整段口型被提前
 * 了 100~170ms，听起来就是「嘴先动、声音后到」。
 *
 * 另一个容易踩的点：词边界只覆盖到最后一个字结束，音频末尾还挂着一截静音。
 * 这不需要特殊处理：TalkingHead 的每个 viseme 关键帧末尾归零，最后一个词
 * 念完嘴会自己闭上，不会一直张着。
 *
 * 关键：msedge-tts 的 metadataStream **不会触发 'end'**（实测音频早已结束它也不关），
 * 所以不能只等它，否则整句音频会被卡在这里一个字都发不出去。这里用
 * 「元数据流结束 / 音频结束 / 兜底超时」三者取先。
 */
function collectWordBoundaries(
  stream: Readable | null | undefined,
  audio: Readable,
): Promise<WordTiming[]> {
  if (!stream) return Promise.resolve([]);

  return new Promise((resolve) => {
    const raw: { text: string; offset: number; duration: number }[] = [];
    let done = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (raw.length === 0) {
        resolve([]);
        return;
      }
      resolve(
        raw.map((w) => ({
          text: w.text,
          // raw 里存的是引擎原始的 100ns 单位，只在这里转一次 ms。
          // 之前在 walk 里就转过一次、finish 里又除一遍，offset 全被压成 0。
          offset: Math.max(0, Math.round(w.offset / 10000)),
          duration: Math.max(20, Math.round(w.duration / 10000)),
        })),
      );
    };
    const timer = setTimeout(finish, 5000);

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const o = node as Record<string, unknown>;
      if (o.Type === 'WordBoundary' && o.Data && typeof o.Data === 'object') {
        const d = o.Data as Record<string, unknown>;
        const text = (d.text as { Text?: string } | undefined)?.Text;
        if (typeof text === 'string' && text.trim() !== '') {
          raw.push({
            text: text.trim(),
            // 保持引擎原始的 100ns 单位，统一在 finish 里换算成 ms
            offset: Number(d.Offset ?? 0),
            duration: Number(d.Duration ?? 0),
          });
        }
      }
      for (const v of Object.values(o)) walk(v);
    };

    stream.on('data', (chunk: Buffer | string) => {
      try {
        walk(JSON.parse(chunk.toString()));
      } catch {
        /* 元数据格式变了就当没有，前端会退回音量驱动 */
      }
    });
    // 元数据通常比音频先结束，但它的 end 事件不可靠，音频收尾才是准的
    stream.on('end', finish);
    stream.on('close', finish);
    audio.on('end', finish);
    audio.on('close', finish);
    stream.on('error', finish);
  });
}

/**
 * 把面试官的一句话按分片合成 MP3 推给客户端。
 * 分片按到达顺序串行合成，保证先说的先播；abort 之后同一轮的音立即停止。
 */
@Injectable()
export class TtsService implements TtsSink {
  private readonly turns = new Map<string, TurnState>();
  private readonly engines = new Map<string, Promise<TtsEngine>>();
  private readonly queues = new Map<string, Promise<void>>();
  /** 已打断的轮次：之后再有 speak 必须静默丢弃，不能重新开一轮 */
  private readonly abortedTurns = new Map<string, Set<string>>();

  constructor(
    @Inject(TtsHub) private readonly transport: TtsTransport,
    @Optional() private readonly factory: TtsEngineFactory = DEFAULT_FACTORY,
  ) {}

  speak(sessionId: string, turnId: string, text: string): void {
    if (this.abortedTurns.get(sessionId)?.has(turnId)) return;

    const turn = this.turns.get(sessionId);
    const state = turn && turn.turnId === turnId ? turn : this.startTurn(sessionId, turnId);

    const segId = state.segId++;
    this.enqueue(sessionId, async () => {
      if (state.aborted) return;
      this.transport.sendJson(sessionId, { type: 'tts_start', turnId, segId, text });

      try {
        const { stream, words } = await this.synthesize(sessionId, text);
        if (state.aborted) {
          stream.destroy();
          return;
        }
        state.current = stream;

        // 词时间戳必须比 seg_done 先到，前端才能在 flush 这一片时用上它；
        // 但不能挡着音频发出去（元数据流的 end 不可靠），所以两路并行。
        const wordsTask = words ?? Promise.resolve<WordTiming[]>([]);
        let wordsSent = false;
        void wordsTask.then((cues) => {
          if (state.aborted || wordsSent || cues.length === 0) return;
          wordsSent = true;
          this.transport.sendJson(sessionId, {
            type: 'tts_words',
            turnId,
            segId,
            words: cues,
          });
        });

        await new Promise<void>((resolve, reject) => {
          stream.on('data', (buf: Buffer) => {
            if (state.aborted) return;
            this.transport.sendAudio(sessionId, buf);
          });
          stream.on('end', () => resolve());
          stream.on('error', reject);
          stream.on('close', () => resolve());
        });

        // 音频已经发完，给时间戳一点收尾时间；走兜底超时也不影响播放
        await Promise.race([wordsTask, new Promise<void>((r) => setTimeout(r, 300))]);

        state.current = undefined;
        if (!state.aborted) this.transport.sendJson(sessionId, { type: 'tts_seg_done', turnId, segId });
      } catch {
        state.current = undefined;
        if (state.aborted) return;
        // 引擎失败时交给前端兜底（浏览器自带语音），不阻塞下一句
        this.transport.sendJson(sessionId, {
          type: 'tts_error',
          turnId,
          segId,
          message: '语音合成不可用',
        });
      }
    });
  }

  finishTurn(sessionId: string, turnId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn || turn.turnId !== turnId) return;

    this.enqueue(sessionId, async () => {
      if (!turn.aborted) this.transport.sendJson(sessionId, { type: 'tts_done', turnId });
      this.turns.delete(sessionId);
      this.closeEngine(sessionId);
    });
  }

  abortTurn(sessionId: string, turnId: string): void {
    const set = this.abortedTurns.get(sessionId) ?? new Set<string>();
    set.add(turnId);
    if (set.size > 50) set.delete(set.values().next().value as string);
    this.abortedTurns.set(sessionId, set);

    const turn = this.turns.get(sessionId);
    if (!turn || turn.turnId !== turnId) return;

    turn.aborted = true;
    turn.current?.destroy();
    turn.current = undefined;
    this.turns.delete(sessionId);
    this.closeEngine(sessionId);
    this.transport.sendJson(sessionId, { type: 'tts_abort', turnId });
  }

  /** 会话结束后释放连接 */
  disposeSession(sessionId: string): void {
    const turn = this.turns.get(sessionId);
    if (turn) this.abortTurn(sessionId, turn.turnId);
    this.turns.delete(sessionId);
    this.queues.delete(sessionId);
    this.abortedTurns.delete(sessionId);
    this.closeEngine(sessionId);
  }

  private startTurn(sessionId: string, turnId: string): TurnState {
    // 上一轮没收尾就先断掉，避免两轮音频交叉
    const prev = this.turns.get(sessionId);
    if (prev) {
      prev.aborted = true;
      prev.current?.destroy();
    }
    const state: TurnState = { turnId, segId: 0, aborted: false };
    this.turns.set(sessionId, state);
    return state;
  }

  private enqueue(sessionId: string, task: () => Promise<void>): void {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const next = prev.then(task).catch(() => undefined);
    this.queues.set(sessionId, next);
  }

  private async synthesize(
    sessionId: string,
    text: string,
  ): Promise<{ stream: Readable; words?: Promise<WordTiming[]> }> {
    const engine = await this.engine(sessionId);
    if (engine.synthesizeWithTiming) {
      const { audio, words } = engine.synthesizeWithTiming(text);
      return { stream: audio, words };
    }
    return { stream: engine.synthesize(text) };
  }

  private engine(sessionId: string): Promise<TtsEngine> {
    let p = this.engines.get(sessionId);
    if (!p) {
      p = this.factory();
      this.engines.set(sessionId, p);
      // 建连失败不能留下一个永远 reject 的 promise
      p.catch(() => this.engines.delete(sessionId));
    }
    return p;
  }

  private closeEngine(sessionId: string): void {
    const p = this.engines.get(sessionId);
    this.engines.delete(sessionId);
    p?.then((e) => e.dispose()).catch(() => undefined);
  }
}