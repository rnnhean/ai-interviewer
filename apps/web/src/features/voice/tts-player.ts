import MSEAudioWrapper from 'mse-audio-wrapper';

export interface TtsPlayerOptions {
  /** 第一帧真正出声 */
  onStart?: () => void;
  /** 整轮播完 */
  onEnd?: () => void;
  /** 播放链路出错，调用方可以提示「本轮只有文字」 */
  onError?: (err: unknown) => void;
  /**
   * 实时音量（0–1），用来驱动数字人口型。
   * 只在真的播放出声时才有值；拿不到就永远不回调，头像自己退回低幅度动画。
   */
  onLevel?: (level: number) => void;
}

/**
 * 一轮面试官发言的播放器。
 *
 * 优先 MediaSource 增量播（mp3 裸流 → fMP4），拿不到 MSE 就退化成
 * 「攒完整轮再一次性播」。两种模式对外接口一致：push / end / abort。
 *
 * 注意：MediaSource 一旦 endOfStream() 就不能再 append，所以**每一轮
 * 发言都要新建一个 player**，不要跨 turn 复用。
 */
export interface TtsPlayer {
  push(chunk: Uint8Array): void;
  /** 服务端说这一轮音频发完了 */
  end(): void;
  /** 打断：立即静音并丢弃未播内容 */
  abort(): void;
  readonly mode: 'mse' | 'blob';
}

/** mp3 在 MSE 里只能包成 fMP4，Chrome / Edge / Firefox 均支持 */
const MP4_MP3 = 'audio/mp4;codecs="mp3"';

function mseSupported(): boolean {
  try {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MP4_MP3);
  } catch {
    return false;
  }
}

export function createTtsPlayer(options: TtsPlayerOptions = {}): TtsPlayer {
  return mseSupported() ? createMsePlayer(options) : createBlobPlayer(options);
}

/**
 * 把播放中的 audio 接到 AnalyserNode 上，按帧回调音量（0–1）。
 *
 * 只用来驱动口型，所以：
 * - 浏览器没有 AudioContext（jsdom、部分受限环境）就直接放弃，头像会退回纯 CSS 动画；
 * - 任何一步出错都静默降级，绝不能因为画不出口型把播放搞崩。
 */
function attachLevelMeter(audio: HTMLAudioElement, onLevel?: (level: number) => void): () => void {
  if (!onLevel) return () => undefined;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return () => undefined;

  let ctx: AudioContext | null = null;
  let raf = 0;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try {
      void ctx?.close();
    } catch {
      /* ignore */
    }
    ctx = null;
    onLevel(0);
  };

  try {
    ctx = new Ctor();
    // 没有用户手势时 AudioContext 会停在 suspended，此时 analyser 全是 0，
    // 而且源元素的声音会跟着一起哑掉，所以必须显式 resume
    if (ctx.state === 'suspended') void ctx.resume();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    // 32 个频点足够看出说话时的起伏，又不必每帧算 1024 个
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const liveCtx = ctx;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = (): void => {
      if (stopped) return;
      // 被浏览器挂起时重新拉起来，否则口型和声音都会停住
      if (liveCtx.state === 'suspended') void liveCtx.resume();
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (const v of buf) sum += v;
      // 平均后再做一次开方：人声的能量集中在低频，线性映射几乎看不出变化
      const avg = sum / (buf.length * 255);
      onLevel(Math.min(1, Math.sqrt(avg) * 1.8));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  } catch {
    stop();
  }

  return stop;
}

function createMsePlayer(options: TtsPlayerOptions): TtsPlayer {
  const audio = new Audio();
  audio.autoplay = true;
  audio.preload = 'auto';

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  audio.src = objectUrl;

  // 输出容器固定 fMP4；mp3 在 webm 里不被支持
  const wrapper = new MSEAudioWrapper('audio/mpeg', {
    preferredContainer: 'fmp4',
    minFramesPerSegment: 2,
    minBytesPerSegment: 576,
  });

  let sourceBuffer: SourceBuffer | null = null;
  let sourceOpened = false;
  let ended = false;
  let aborted = false;
  let playAttempts = 0;
  let pending: Uint8Array[] = [];
  /** 拆掉音量表；没接上就是空函数 */
  let detachLevel: () => void = () => undefined;

  const ensurePlay = (): void => {
    if (aborted || playAttempts >= 3) return;
    playAttempts += 1;
    // 自动播放被拦时静默等待，后续 push 会再试
    audio.play().catch(() => undefined);
  };

  const flush = (): void => {
    const sb = sourceBuffer;
    if (!sb || sb.updating || pending.length === 0 || aborted) return;
    const next = pending.shift();
    if (!next) return;
    try {
      sb.appendBuffer(next as unknown as BufferSource);
    } catch (err) {
      options.onError?.(err);
    }
  };

  const tryOpenBuffer = (): void => {
    if (!sourceOpened || sourceBuffer || aborted) return;
    try {
      sourceBuffer = mediaSource.addSourceBuffer(MP4_MP3);
      sourceBuffer.addEventListener('updateend', () => {
        flush();
        if (ended && pending.length === 0 && mediaSource.readyState === 'open') {
          try {
            mediaSource.endOfStream();
          } catch {
            /* 已经关过了 */
          }
        }
      });
      flush();
    } catch (err) {
      options.onError?.(err);
    }
  };

  mediaSource.addEventListener('sourceopen', () => {
    sourceOpened = true;
    tryOpenBuffer();
    ensurePlay();
  });

  // createMediaElementSource 同一个元素只能接一次，用 flag 防重入
  let levelAttached = false;
  audio.addEventListener('playing', () => {
    options.onStart?.();
    if (!levelAttached) {
      levelAttached = true;
      detachLevel = attachLevelMeter(audio, options.onLevel);
    }
  });
  audio.addEventListener('ended', () => {
    detachLevel();
    if (!aborted) options.onEnd?.();
  });

  return {
    mode: 'mse',

    push(chunk: Uint8Array): void {
      if (aborted) return;
      try {
        for (const segment of wrapper.iterator(chunk)) pending.push(segment);
      } catch (err) {
        options.onError?.(err);
        return;
      }
      // 长时间没消费掉说明源缓冲卡住了，丢老数据保新数据
      if (pending.length > 300) pending = pending.slice(-150);
      ensurePlay();
      flush();
    },

    end(): void {
      if (aborted) return;
      ended = true;
      flush();
      if (pending.length === 0 && mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch {
          /* ignore */
        }
      }
    },

    abort(): void {
      if (aborted) return;
      aborted = true;
      pending = [];
      detachLevel();
      try {
        if (sourceBuffer?.updating) sourceBuffer.abort();
      } catch {
        /* ignore */
      }
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        /* ignore */
      }
      try {
        if (mediaSource.readyState === 'open') mediaSource.endOfStream();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(objectUrl);
    },
  };
}

/** 兜底：把整轮音频攒成 Blob，服务端说完了再一次性播 */
function createBlobPlayer(options: TtsPlayerOptions): TtsPlayer {
  const chunks: Uint8Array[] = [];
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let aborted = false;
  let stopLevel: () => void = () => undefined;

  const release = (): void => {
    if (!audio) return;
    stopLevel();
    try {
      audio.pause();
      audio.removeAttribute('src');
    } catch {
      /* ignore */
    }
    audio = null;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  return {
    mode: 'blob',

    push(chunk: Uint8Array): void {
      if (aborted) return;
      chunks.push(chunk);
    },

    end(): void {
      if (aborted || chunks.length === 0) return;
      const blob = new Blob(chunks as unknown as BlobPart[], { type: 'audio/mpeg' });
      chunks.length = 0;
      objectUrl = URL.createObjectURL(blob);
      audio = new Audio(objectUrl);
      audio.autoplay = true;
      let detachLevel: () => void = () => undefined;
      let levelAttached = false;
      audio.addEventListener('playing', () => {
        options.onStart?.();
        if (!levelAttached) {
          levelAttached = true;
          detachLevel = attachLevelMeter(audio!, options.onLevel);
        }
      });
      audio.addEventListener('ended', () => {
        detachLevel();
        if (aborted) return;
        release();
        options.onEnd?.();
      });
      audio.play().catch((err: unknown) => options.onError?.(err));
      stopLevel = () => detachLevel();
    },

    abort(): void {
      if (aborted) return;
      aborted = true;
      chunks.length = 0;
      stopLevel();
      release();
    },
  };
}
