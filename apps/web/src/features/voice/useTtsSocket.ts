import { useCallback, useEffect, useRef, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import type { TtsClientMessage, TtsServerMessage } from '@ai-interviewer/shared';
import { parseWsJson } from '@ai-interviewer/shared';
import { wsUrl } from '../../api/client';
import type { TalkingHead } from '@met4citizen/talkinghead';
import { createTtsPlayer, type TtsPlayer } from './tts-player';
import { createSpeechSink, type SpeechSink } from './talking-head-sink';

export type TtsState = 'idle' | 'speaking' | 'error';

export type TtsTurnEvent = 'started' | 'done' | 'aborted' | 'error';

/** 口型刷新的最小间隔：约 30fps，肉眼够顺，又不至于每帧都触发重渲染 */
const LEVEL_UI_INTERVAL_MS = 33;

/** 数字人侧暴露给这里的接口，只依赖「拿得到 head」这一件事 */
export interface DigitalAvatarHandle {
  getHead: () => TalkingHead | null;
}

export interface UseTtsSocketOptions {
  sessionId: string;
  /**
   * 数字人就绪后返回它的句柄。拿得到时音频改走 3D 口型输出；
   * 还没加载好（返回 null）就先走默认播放器。
   */
  getAvatar?: () => DigitalAvatarHandle | null;
  /** 服务端通告本轮音频状态变化 */
  onTurnState?: (state: TtsTurnEvent, turnId: string) => void;
  /** 播放链路彻底不可用，页面可以提示「本轮只有文字」 */
  onUnavailable?: (err: unknown) => void;
  /** 关掉浏览器自带语音兜底（测试时用） */
  disableSpeechFallback?: boolean;
}

/** 浏览器自带语音兜底。没有可用声音时静默跳过 */
function speakWithBrowserVoice(text: string): boolean {
  if (typeof speechSynthesis === 'undefined' || text.trim() === '') return false;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

/**
 * `/ws/tts` 客户端：文本帧是元信息，二进制帧是 mp3 音频。
 *
 * 一轮一个 TtsPlayer（MediaSource 一旦 endOfStream 就不能复用），
 * `tts_start` 建新的、`tts_done` 收尾、`tts_abort` 丢弃。
 * 合成失败或音频链路不可用时，用浏览器自带语音把这一轮读完。
 */
export function useTtsSocket(options: UseTtsSocketOptions) {
  const [state, setState] = useState<TtsState>('idle');
  const [connected, setConnected] = useState(false);
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
  /**
   * 当前说话音量（0–1），驱动数字人口型。
   * 用 ref 存实时值、state 存节流后的值：口型每帧都变，但重渲染每分钟几百次没必要。
   */
  const levelRef = useRef(0);
  const [level, setLevel] = useState(0);
  const playerRef = useRef<TtsPlayer | null>(null);
  /** 当前播放器属于哪一轮，用来区分同一轮内的多个分片 */
  const turnRef = useRef<string | null>(null);
  /** 当前轮已合成的文本，兜底朗读用 */
  const spokenRef = useRef('');
  const socketRef = useRef<ReconnectingWebSocket | null>(null);
  /** 上一次把音量写进 state 的时间，用来节流 */
  const lastLevelAt = useRef(0);
  const sinkRef = useRef<SpeechSink | null>(null);
  const handlers = useRef(options);
  handlers.current = options;

  /**
   * 数字人就绪后，音频改走它的 3D 口型输出；没就绪就返回 null，
   * 由调用处退回默认播放器，避免加载期间整段没声音。
   */
  const getSink = useCallback((): SpeechSink | null => {
    const avatar = handlers.current.getAvatar?.();
    if (!avatar) return null;
    if (!sinkRef.current) {
      sinkRef.current = createSpeechSink({
        getHead: () => avatar.getHead(),
        onStart: () => setState('speaking'),
        onEnd: () => {
          setState('idle');
          levelRef.current = 0;
          setLevel(0);
        },
        onError: (err) => {
          setState('error');
          handlers.current.onUnavailable?.(err);
        },
      });
    }
    return sinkRef.current;
  }, []);

  const dropPlayer = useCallback((abort: boolean) => {
    if (abort) {
      playerRef.current?.abort();
      sinkRef.current?.abort();
    }
    playerRef.current = null;
    turnRef.current = null;
    levelRef.current = 0;
    setLevel(0);
  }, []);

  /** 同一轮内不重建；只有轮次变了才换播放器 */
  const newPlayer = useCallback(
    (turnId: string): TtsPlayer => {
      if (turnRef.current === turnId && playerRef.current) return playerRef.current;
      dropPlayer(true);
      turnRef.current = turnId;
      const player = createTtsPlayer({
        onStart: () => setState('speaking'),
        onEnd: () => {
          setState('idle');
          playerRef.current = null;
          levelRef.current = 0;
          setLevel(0);
        },
        onError: (err) => {
          setState('error');
          handlers.current.onUnavailable?.(err);
          if (!handlers.current.disableSpeechFallback && spokenRef.current !== '') {
            speakWithBrowserVoice(spokenRef.current);
          }
        },
        // 口型不需要每帧都进 React，做一次轻量节流
        onLevel: (next) => {
          levelRef.current = next;
          const now = performance.now();
          if (now - lastLevelAt.current >= LEVEL_UI_INTERVAL_MS) {
            lastLevelAt.current = now;
            setLevel(next);
          }
        },
      });
      playerRef.current = player;
      return player;
    },
    [dropPlayer],
  );

  /** 音频可能先于 tts_start 到达（服务端刚补发过控制帧），这里兜底 */
  const ensurePlayer = useCallback((): TtsPlayer => playerRef.current ?? newPlayer(turnRef.current ?? 'unknown'), [newPlayer]);

  useEffect(() => {
    const url = wsUrl('/ws/tts', options.sessionId);
    const socket = new ReconnectingWebSocket(url, [], { maxRetries: 5, connectionTimeout: 5000 });
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const onOpen = (): void => setConnected(true);
    const onClose = (): void => setConnected(false);

    const onMessage = (ev: MessageEvent): void => {
      const data = ev.data as unknown;

      if (typeof data !== 'string') {
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : null;
        if (bytes && bytes.byteLength > 0) {
          const sink = getSink();
          if (sink) sink.push(bytes);
          else ensurePlayer().push(bytes);
        }
        return;
      }

      const msg = parseWsJson<TtsServerMessage>(data);
      if (!msg) return;

      switch (msg.type) {
        case 'tts_start': {
          // 同一轮会有多个分片，每片都会发 tts_start；只有轮次变了才换输出通道，
          // 否则会把上一片没播完的音频打断
          const sink = getSink();
          if (turnRef.current !== msg.turnId) {
            spokenRef.current = msg.text;
            if (sink) {
              // 新一轮开口：把上一轮残留的音频停掉，但保留 sink 实例复用
              dropPlayer(true);
              turnRef.current = msg.turnId;
            } else {
              newPlayer(msg.turnId);
            }
          } else {
            spokenRef.current += msg.text;
          }
          // 没有数字人时用播放器，turnRef 由 newPlayer 设过；有 sink 时上面已设
          setCurrentTurnId(msg.turnId);
          setState('speaking');
          handlers.current.onTurnState?.('started', msg.turnId);
          break;
        }
        case 'tts_done':
          // 没有跑过 start 的一轮（比如纯文字）就不必建播放器
          if (sinkRef.current) sinkRef.current.end();
          else playerRef.current?.end();
          setCurrentTurnId(null);
          handlers.current.onTurnState?.('done', msg.turnId);
          break;
        case 'tts_abort':
          dropPlayer(true);
          setState('idle');
          setCurrentTurnId(null);
          handlers.current.onTurnState?.('aborted', msg.turnId);
          break;
        case 'tts_error':
          dropPlayer(true);
          setState('error');
          setCurrentTurnId(null);
          handlers.current.onTurnState?.('error', msg.turnId);
          handlers.current.onUnavailable?.(new Error(msg.message));
          if (!handlers.current.disableSpeechFallback) speakWithBrowserVoice(spokenRef.current);
          break;
        case 'tts_words':
          // 词级时间戳：拿到就能把口型对到念出的字上
          if (sinkRef.current && turnRef.current === msg.turnId) {
            sinkRef.current.setWords(msg.words);
          }
          break;
        case 'tts_seg_done':
          // 一个分片的 mp3 收全了，这才能解码出完整波形喂给口型
          sinkRef.current?.flush();
          break;
      }
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('message', onMessage);
    return () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('message', onMessage);
      socket.close();
      socketRef.current = null;
      dropPlayer(true);
    };
  }, [options.sessionId, ensurePlayer, newPlayer, dropPlayer, getSink]);

  const send = useCallback((msg: TtsClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  /** 打断：本地立刻静音，同时告诉服务端别再发音频 */
  const bargeIn = useCallback(
    (turnId: string) => {
      dropPlayer(true);
      setState('idle');
      setCurrentTurnId(null);
      send({ type: 'barge_in', turnId });
    },
    [dropPlayer, send],
  );

  const abortLocal = useCallback(() => {
    dropPlayer(true);
    setState('idle');
    setCurrentTurnId(null);
    if (typeof speechSynthesis !== 'undefined') {
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }, [dropPlayer]);

  return { state, connected, currentTurnId, level, speaking: state === 'speaking', bargeIn, abortLocal };
}
