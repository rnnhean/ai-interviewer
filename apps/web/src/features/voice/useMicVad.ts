import { useCallback, useEffect, useRef, useState } from 'react';
import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web';
import { frameEnergy, floatToInt16 } from './pcm';

export interface UseMicVadOptions {
  /** 每一帧 PCM（16kHz 单声道 int16）。`speech` 表示这一帧是否处于人声区间 */
  onFrame?: (pcm: Int16Array, energy: number, at: number, speech: boolean) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  /** 麦克风权限被拒 / 设备不可用 */
  onDenied?: (reason: string) => void;
}

const VAD_ASSET_PATH = '/vad/';

/** 开口前的补发窗口，覆盖 VAD 判定延迟，避免每句话丢掉起始音节 */
const PRE_SPEECH_PAD_MS = 500;
const FRAME_SAMPLES = 512;
const FRAME_MS = (FRAME_SAMPLES / 16_000) * 1000;
const PAD_FRAMES = Math.ceil(PRE_SPEECH_PAD_MS / FRAME_MS);

interface CachedFrame {
  pcm: Int16Array;
  energy: number;
  at: number;
}

/**
 * 麦克风 + Silero VAD。
 *
 * 注意 `@ricky0123/vad-web` 0.0.31 的选项单位是**毫秒**（minSpeechMs / preSpeechPadMs /
 * redemptionMs），不是帧数；写成 Frames 的字段会被静默忽略。
 *
 * `onFrameProcessed` 在「是否人声」判定之前触发，所以开头几帧当时拿不到 speech 状态。
 * 这里缓存最近一小段帧，`onSpeechStart` 时补发，避免 ASR 每句话都缺头。
 */
export function useMicVad(options: UseMicVadOptions) {
  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState(true);
  const vadRef = useRef<MicVAD | null>(null);
  const handlers = useRef(options);
  handlers.current = options;

  /** 人声开始前的环形缓存 */
  const padRef = useRef<CachedFrame[]>([]);
  const speakingRef = useRef(false);

  const resetPad = (): void => {
    padRef.current = [];
    speakingRef.current = false;
  };

  const start = useCallback(async (): Promise<void> => {
    if (vadRef.current) {
      await vadRef.current.start();
      resetPad();
      setListening(true);
      return;
    }

    try {
      const vadOptions: Partial<RealTimeVADOptions> = {
        model: 'v5',
        startOnLoad: false,
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        // 512 samples @16k ≈ 32ms 一帧；服务端会把 PCM 再切成腾讯 ASR 要的 40ms
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.35,
        minSpeechMs: 300,
        preSpeechPadMs: PRE_SPEECH_PAD_MS,
        redemptionMs: 800,
        onFrameProcessed: (_probs, frame) => {
          const pcm = floatToInt16(frame);
          const energy = frameEnergy(frame);
          const at = performance.now();
          const speaking = speakingRef.current;

          if (!speaking) {
            padRef.current.push({ pcm, energy, at });
            if (padRef.current.length > PAD_FRAMES) padRef.current.shift();
          }
          handlers.current.onFrame?.(pcm, energy, at, speaking);
        },
        onSpeechStart: () => {
          speakingRef.current = true;
          // 补发开口前的缓存帧，让 ASR 拿到完整的起始音节
          for (const f of padRef.current) handlers.current.onFrame?.(f.pcm, f.energy, f.at, true);
          padRef.current = [];
          handlers.current.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          speakingRef.current = false;
          padRef.current = [];
          handlers.current.onSpeechEnd?.();
        },
        onVADMisfire: () => {
          speakingRef.current = false;
          padRef.current = [];
        },
        getStream: () =>
          navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          }),
        pauseStream: async (stream) => {
          stream.getTracks().forEach((t) => t.stop());
        },
        resumeStream: () =>
          navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          }),
        processorType: 'AudioWorklet',
        audioContext: new AudioContext({ sampleRate: 16_000 }),
      };

      const vad = await MicVAD.new(vadOptions);
      vadRef.current = vad;
      resetPad();
      await vad.start();
      setListening(true);
      setAvailable(true);
    } catch (err) {
      setListening(false);
      setAvailable(false);
      const message =
        err instanceof Error && /NotAllowed|Permission/i.test(err.message) ? '麦克风权限被拒绝' : '麦克风不可用';
      handlers.current.onDenied?.(message);
    }
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    await vadRef.current?.pause();
    resetPad();
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      void vadRef.current?.destroy();
      vadRef.current = null;
    };
  }, []);

  return { listening, available, start, stop };
}
