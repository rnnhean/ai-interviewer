import { useCallback, useEffect, useRef, useState } from 'react';
import { BARGE_IN_ENERGY_MS } from '@ai-interviewer/shared';
import { createBargeInDetector } from './barge-in';
import { createTurnAssembler } from './turn-assembler';
import { useAsrSocket } from './useAsrSocket';
import { useMicVad } from './useMicVad';

/** 组装器 tick 间隔：足够让 2.5s 静音判定准到 ±250ms */
const TICK_MS = 250;

export interface UseVoiceSessionOptions {
  sessionId: string;
  /** 一轮回答凑齐后回调，由页面发给模型 */
  onSubmit: (text: string) => void;
  /** 数字人正在说话时开口 → 打断 */
  onBargeIn?: () => void;
  /** 字幕/麦克风不可用时的提示 */
  onVoiceError?: (message: string) => void;
  enabled?: boolean;
}

export interface VoiceSession {
  listening: boolean;
  available: boolean;
  connected: boolean;
  asrMode: 'mock' | 'live' | null;
  /** 已确认、等待提交的整轮文本 */
  draft: string;
  /** ASR 未定稿的灰字 */
  partial: string;
  inSpeech: boolean;
  lastError: string | null;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  /** 手动提交当前一轮（自动静音提交之外的兜底） */
  submitNow: () => void;
  /** 页面告诉这里「数字人是否正在说话」，决定是否启用打断检测 */
  setInterviewerSpeaking: (speaking: boolean) => void;
}

/**
 * 把麦克风、VAD、ASR socket、轮次组装器、barge-in 串起来。
 * 静音帧只做打断判定，人声帧才送 ASR。
 */
export function useVoiceSession(options: UseVoiceSessionOptions): VoiceSession {
  const { sessionId, onSubmit, onBargeIn, onVoiceError, enabled = true } = options;

  const [draft, setDraft] = useState('');
  const [partial, setPartial] = useState('');
  const [inSpeech, setInSpeech] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const handlers = useRef({ onSubmit, onBargeIn, onVoiceError });
  handlers.current = { onSubmit, onBargeIn, onVoiceError };

  const assemblerRef = useRef(createTurnAssembler());
  const bargeRef = useRef(createBargeInDetector({ energyMs: BARGE_IN_ENERGY_MS, threshold: 0.06 }));
  const inSpeechRef = useRef(false);
  const interviewerSpeakingRef = useRef(false);
  const voiceSeq = useRef(0);
  const activeVoiceId = useRef('');
  /** 本轮 utterance 是否真的送过音频；没有就 cancel，不触发「没听清」 */
  const sentAudioRef = useRef(false);

  const consumeSubmits = useCallback((out: { type: 'submit'; text: string }[]) => {
    if (out.length === 0) return;
    setDraft('');
    setPartial('');
    for (const item of out) handlers.current.onSubmit(item.text);
  }, []);

  const asr = useAsrSocket({
    sessionId,
    onPartial: (_voiceId, text) => setPartial(text),
    onFinal: (_voiceId, text) => {
      setPartial('');
      consumeSubmits(assemblerRef.current.push({ type: 'segment_final', text, at: Date.now() }));
      setDraft(assemblerRef.current.state().text);
    },
    onNormalized: (_voiceId, text) => {
      if (text.trim() === '') return;
      assemblerRef.current.replaceLast(text);
      setDraft(assemblerRef.current.state().text);
    },
    onError: (message) => {
      setLastError(message);
      handlers.current.onVoiceError?.(message);
    },
  });

  const vad = useMicVad({
    onFrame: (pcm, energy, at, speech) => {
      if (interviewerSpeakingRef.current) {
        // 数字人说话期间只做打断判定，音频一律不送 ASR，
        // 否则外放回声会被当成候选人在回答
        if (bargeRef.current.feed(energy, at)) {
          interviewerSpeakingRef.current = false;
          handlers.current.onBargeIn?.();
        }
        return;
      }
      if (speech) {
        sentAudioRef.current = true;
        asr.sendAudio(pcm);
      }
    },
    onSpeechStart: () => {
      inSpeechRef.current = true;
      setInSpeech(true);
      sentAudioRef.current = false;
      voiceSeq.current += 1;
      activeVoiceId.current = `v${voiceSeq.current}`;
      asr.sendControl({ type: 'utterance_start', voiceId: activeVoiceId.current });
    },
    onSpeechEnd: () => {
      inSpeechRef.current = false;
      setInSpeech(false);
      // 说话的整段都落在数字人发言窗口里 → 一帧音频都没送，取消而不是「结束」
      const kind = sentAudioRef.current ? 'utterance_end' : 'utterance_cancel';
      asr.sendControl({ type: kind, voiceId: activeVoiceId.current });
    },
    onDenied: (reason) => {
      setLastError(reason);
      handlers.current.onVoiceError?.(reason);
    },
  });

  // 定时 tick：静音超时 / 硬上限自动提交
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      consumeSubmits(assemblerRef.current.push({ type: 'tick', at: Date.now() }));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, consumeSubmits]);

  const setInterviewerSpeaking = useCallback((speaking: boolean) => {
    interviewerSpeakingRef.current = speaking;
    if (speaking) {
      bargeRef.current.reset();
      // 超长回答被硬上限提交后数字人立刻开口：把还没结束的那段 utterance 取消，
      // 免得把面试官的声音录进候选人的回答里
      if (inSpeechRef.current) {
        asr.sendControl({ type: 'utterance_cancel', voiceId: activeVoiceId.current });
        inSpeechRef.current = false;
        sentAudioRef.current = false;
        setInSpeech(false);
      }
    }
  }, [asr]);

  const submitNow = useCallback(() => {
    consumeSubmits(assemblerRef.current.push({ type: 'manual_submit', at: Date.now() }));
  }, [consumeSubmits]);

  return {
    listening: vad.listening,
    available: vad.available,
    connected: asr.connected,
    asrMode: asr.mode,
    draft,
    partial,
    inSpeech,
    lastError,
    startListening: vad.start,
    stopListening: vad.stop,
    submitNow,
    setInterviewerSpeaking,
  };
}
