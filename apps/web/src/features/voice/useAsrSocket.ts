import { useCallback, useEffect, useRef, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import type { AsrClientMessage, AsrServerMessage } from '@ai-interviewer/shared';
import { parseWsJson } from '@ai-interviewer/shared';
import { wsUrl } from '../../api/client';

export interface UseAsrSocketOptions {
  sessionId: string;
  onReady?: (mode: 'mock' | 'live') => void;
  onPartial?: (voiceId: string, text: string) => void;
  onFinal?: (voiceId: string, text: string) => void;
  onNormalized?: (voiceId: string, text: string) => void;
  onError?: (message: string) => void;
  /** 测试注入 */
  connect?: (url: string) => WebSocketLike;
}

export interface WebSocketLike {
  readyState: number;
  binaryType: string;
  send: (data: string | ArrayBufferLike | ArrayBufferView) => void;
  close: () => void;
  addEventListener: (type: string, listener: (ev: Event) => void) => void;
  removeEventListener: (type: string, listener: (ev: Event) => void) => void;
}

/**
 * `/ws/asr` 客户端：发二进制 PCM 帧 + 起止文本帧，收 partial / final / normalized。
 * 断线由 reconnecting-websocket 自动重连。
 */
export function useAsrSocket(options: UseAsrSocketOptions) {
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<'mock' | 'live' | null>(null);
  const socketRef = useRef<WebSocketLike | null>(null);
  const handlers = useRef(options);
  handlers.current = options;

  useEffect(() => {
    const url = wsUrl('/ws/asr', options.sessionId);
    const socket = options.connect
      ? options.connect(url)
      : (new ReconnectingWebSocket(url, [], { maxRetries: 5, connectionTimeout: 4000 }) as unknown as WebSocketLike);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const onOpen = (): void => setConnected(true);
    const onClose = (): void => setConnected(false);
    const onMessage = (ev: Event): void => {
      const msgEvent = ev as MessageEvent;
      const raw = typeof msgEvent.data === 'string' ? msgEvent.data : null;
      if (raw === null) return;
      const msg = parseWsJson<AsrServerMessage>(raw);
      if (!msg) return;
      switch (msg.type) {
        case 'asr_ready':
          setMode(msg.mode);
          handlers.current.onReady?.(msg.mode);
          break;
        case 'asr_partial':
          handlers.current.onPartial?.(msg.voiceId, msg.text);
          break;
        case 'asr_final':
          handlers.current.onFinal?.(msg.voiceId, msg.text);
          break;
        case 'asr_normalized':
          handlers.current.onNormalized?.(msg.voiceId, msg.text);
          break;
        case 'asr_error':
          handlers.current.onError?.(msg.message);
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
    };
  }, [options.sessionId, options.connect]);

  const sendAudio = useCallback((pcm: Int16Array) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1) return;
    // 直接发整段缓冲区，服务端负责 1280 字节分帧
    socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  }, []);

  const sendControl = useCallback((msg: AsrClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(msg));
  }, []);

  return { connected, mode, sendAudio, sendControl };
}
