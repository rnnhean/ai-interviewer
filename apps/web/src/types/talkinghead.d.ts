/**
 * TalkingHead 只发 .mjs，不带类型声明。这里按实际用到的 API 补一份最小声明，
 * 不用 any 把整个模块糊过去。
 */
declare module '@met4citizen/talkinghead' {
  export interface TalkingHeadOptions {
    cameraView?: 'full' | 'mid' | 'upper' | 'head';
    modelFPS?: number;
    lipsyncModules?: string[];
    lipsyncLang?: string;
    modelPixelRatio?: number;
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    avatarIdleHeadMove?: number;
    avatarIdleEyeContact?: number;
    avatarSpeakingHeadMove?: number;
    cameraDistance?: number;
    cameraX?: number;
    cameraY?: number;
    pcmSampleRate?: number;
    audioCtx?: AudioContext;
    mixerGainSpeech?: number;
    [key: string]: unknown;
  }

  export interface AvatarOptions {
    url: string;
    body?: 'M' | 'F';
    lipsyncLang?: string;
    [key: string]: unknown;
  }

  /** streamAudio 的分片：16-bit LE PCM，可选带口型数据 */
  export interface StreamChunk {
    audio: ArrayBuffer | Int16Array;
    visemes?: string[];
    vtimes?: number[];
    vdurations?: number[];
    words?: string[];
    wtimes?: number[];
    wdurations?: number[];
    [key: string]: unknown;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);

    showAvatar(
      avatar: AvatarOptions,
      onprogress?: ((url: string, loaded: number, total: number) => void) | null,
    ): Promise<void>;

    setView(view: 'full' | 'mid' | 'upper' | 'head', opt?: Record<string, unknown>): void;
    speakText(text: string, opt?: Record<string, unknown>, onsubtitles?: unknown, excludes?: unknown): void;
    stopSpeaking(): void;

    streamStart(
      opt?: Record<string, unknown>,
      onAudioStart?: (() => void) | null,
      onAudioEnd?: (() => void) | null,
      onSubtitles?: unknown,
      onMetrics?: unknown,
    ): Promise<void>;
    streamAudio(chunk: StreamChunk): void;
    streamNotifyEnd(): void;
    streamInterrupt(): void;
    streamStop(): void;

    setMood(mood: string): void;
    makeEyeContact(t: number): void;

    /** 卸载时必须调用：停动画帧、释放 WebGL 上下文、移除 canvas */
    dispose(): void;
  }
}