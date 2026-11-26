import type { TalkingHead } from '@met4citizen/talkinghead';
import { pinyin } from 'pinyin-pro';

/**
 * 把服务端推来的 mp3 分片解码成 PCM，喂给 TalkingHead 的流式口型接口。
 *
 * 口型有两层信息：
 * - **什么时候张嘴**：TTS 引擎给每个词的精确时间戳（WordBoundary），
 *   没词的时候就是静音，嘴要闭上。
 * - **张成什么形状**：中文没有现成的 lip-sync 模块，用拼音把词拆成声母/韵母，
 *   映射到 Oculus 的 15 个 viseme，在词的时间窗内按音节铺开。
 *
 * 只用音量驱动会变成「漫无目的张嘴」——有声音就开合，和念的是哪个字无关。
 * 这里以词时间戳为主，音节时长按韵母类型微调，口型才和念出的字对得上。
 */

/** 一个 viseme 的最小时长，太短的话 Morph 来不及过渡，看起来像抖 */
const MIN_VISEME_MS = 45;

/** 单个 viseme 的最长保持时间，长音节也不会一直张着嘴 */
const MAX_VISEME_MS = 180;

/**
 * 每个 viseme 只占分配时长的这个比例，剩下的留作收口间隙。
 *
 * 不能铺满：TalkingHead 给每个 viseme 的关键帧是 [t-2d/3, t+d/2, t+d+d/2]，
 * 如果前一个的时长等于后一个的间隔，前一个的归零点会正好压在后一个的峰值上，
 * 两者互相抵消，嘴就变成大部分时间不动。
 */
const DUTY = 0.6;

export interface SpeechSinkOptions {
  getHead: () => TalkingHead | null;
  /** 一段音频真正开始出声 */
  onStart?: () => void;
  /** 队列里所有音频都播完了 */
  onEnd?: () => void;
  /** 播放链路报错 */
  onError?: (err: unknown) => void;
}

export interface WordCue {
  text: string;
  /** 相对本段音频起点的偏移（ms） */
  offset: number;
  duration: number;
}

export interface SpeechSink {
  /** 收到一段 mp3 字节，先攒着 */
  push(bytes: Uint8Array): void;
  /** 本段的词级时间戳，通常比音频先到 */
  setWords(words: WordCue[]): void;
  /** 当前分片收完，可以解码播了 */
  flush(): void;
  /** 本轮没有更多分片 */
  end(): void;
  /** 打断，立刻停 */
  abort(): void;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Float32 [-1,1] → 16bit LE，TalkingHead 的流式接口要这个格式 */
function toPcm16(buffer: AudioBuffer, targetRate = 24000): Int16Array {
  const src = buffer.getChannelData(0);
  const srcRate = buffer.sampleRate;

  // 正常情况下解码上下文已经是 24k，直接转。只有浏览器拒绝指定采样率时才会
  // 走到重采样分支：不重采样就会以两倍时长回放，声音变慢、变低沉、发糊。
  if (srcRate === targetRate) {
    const fast = new Int16Array(src.length);
    for (let i = 0; i < src.length; i += 1) {
      const s = Math.max(-1, Math.min(1, src[i]!));
      fast[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return fast;
  }

  const ratio = srcRate / targetRate;
  const length = Math.max(1, Math.floor(src.length / ratio));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    // 线性插值：语音够用，不会引入明显失真
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const frac = pos - i0;
    const s = Math.max(-1, Math.min(1, src[i0]! * (1 - frac) + src[i1]! * frac));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * 声母 → viseme。
 *
 * 依据是发音部位：双唇音（b/p/m）闭嘴，唇齿音（f）上齿咬下唇，
 * 舌尖音（d/t/n/l）舌尖抵齿，翘舌（zh/ch/sh/r）卷舌，舌面（j/q/x）扁平，
 * 舌根（g/k/h）后缩，平舌（z/c/s）接近舌尖。
 */
const INITIAL_VISEME: Record<string, string> = {
  b: 'PP', p: 'PP', m: 'PP',
  f: 'FF',
  d: 'DD', t: 'DD', n: 'DD', l: 'DD',
  zh: 'CH', ch: 'CH', sh: 'CH', r: 'CH',
  j: 'SS', q: 'SS', x: 'SS',
  g: 'kk', k: 'kk', h: 'kk',
  z: 'SS', c: 'SS', s: 'SS',
  y: 'I', w: 'U',
};

/**
 * 韵母 → viseme 序列。
 *
 * 按「介音 + 韵腹 + 韵尾」拆开，而不是只取主元音。只看主元音的话，
 * 「面」的 ian 只会给出 I、nn 两个口型，中间那个张开的 a 整个丢掉，
 * 看起来就像含着东西说话——嘴型变化密度远低于真实发音。
 */
const FINAL_UNITS: Record<string, string[]> = {
  // 单韵母
  a: ['aa'], o: ['O'], e: ['E'], i: ['I'], u: ['U'], v: ['U'], er: ['RR'],
  // 复韵母
  ai: ['aa', 'I'], ei: ['E', 'I'], ao: ['aa', 'O'], ou: ['O', 'U'],
  ia: ['I', 'aa'], ie: ['I', 'E'], iao: ['I', 'aa', 'O'], iu: ['I', 'O', 'U'],
  ua: ['U', 'aa'], uo: ['U', 'O'], uai: ['U', 'aa', 'I'], ui: ['U', 'E', 'I'],
  ve: ['U', 'E'],
  // 鼻韵母
  an: ['aa', 'nn'], en: ['E', 'nn'], ang: ['aa', 'nn'], eng: ['E', 'nn'], ong: ['O', 'nn'],
  in: ['I', 'nn'], un: ['U', 'E', 'nn'],
  ian: ['I', 'aa', 'nn'], iang: ['I', 'aa', 'nn'], ing: ['I', 'nn'], iong: ['I', 'O', 'nn'],
  uan: ['U', 'aa', 'nn'], uang: ['U', 'aa', 'nn'], ueng: ['U', 'E', 'nn'],
  van: ['U', 'aa', 'nn'], vn: ['U', 'nn'],
};

const VOWEL_VISEME: Record<string, string> = {
  a: 'aa', o: 'O', e: 'E', i: 'I', u: 'U', v: 'U',
};

/** 表里没有的韵母（生僻组合）退化成逐个字母，至少嘴会跟着动 */
function finalToVisemes(final: string): string[] {
  const f = final.replace(/ü/g, 'v');
  const exact = FINAL_UNITS[f];
  if (exact) return exact.slice();
  return [...f].map((c) => VOWEL_VISEME[c] ?? 'E');
}

/**
 * 拆一个词 → 每个音节的 viseme 序列。
 *
 * 返回二维数组是为了让调用方能**按音节分配时长**：一整句里每个音节念得
 * 差不多久，不能因为某个音节的音素多就多占时间。
 */
function textToSyllableVisemes(text: string): string[][] {
  // 只保留汉字和字母，标点不发音
  const clean = text.replace(/[^一-龥a-zA-Z]/g, '');
  if (clean === '') return [];

  const hasChinese = /[一-龥]/.test(clean);
  const parts = pinyin(clean, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
  const out: string[][] = [];

  for (const raw of parts) {
    if (!raw) continue;
    const syl = raw.toLowerCase().trim();
    if (syl === '') continue;

    // 英文/数字：一个字母一个口型，总比不动强
    if (!hasChinese || !isPinyinSyllable(syl)) {
      out.push(...latinToVisemes(syl).map((v) => [v]));
      continue;
    }

    const { initial, final } = splitSyllable(syl);
    const units: string[] = [];
    if (initial && INITIAL_VISEME[initial]) units.push(INITIAL_VISEME[initial]!);
    units.push(...finalToVisemes(final));
    if (units.length > 0) out.push(units);
  }

  return out;
}

/** 拆一个词里的所有音节 → viseme 序列（按发音顺序，扁平） */
export function textToVisemes(text: string): string[] {
  return textToSyllableVisemes(text).flat();
}

function isPinyinSyllable(s: string): boolean {
  return /^[a-z]+$/.test(s) && /[aeiouv]/.test(s);
}

/** 声母最长两个字母（zh/ch/sh），剩下的是韵母 */
function splitSyllable(syl: string): { initial: string; final: string } {
  const two = syl.slice(0, 2);
  if (['zh', 'ch', 'sh'].includes(two)) return { initial: two, final: syl.slice(2) };
  const one = syl.slice(0, 1);
  if ('bpmfdtnlgkhjqxrzcsyw'.includes(one)) return { initial: one, final: syl.slice(1) };
  return { initial: '', final: syl };
}

function latinToVisemes(word: string): string[] {
  const map: Record<string, string> = { a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I' };
  const out: string[] = [];
  for (const ch of word) {
    if (map[ch]) out.push(map[ch]!);
    else if ('bmp'.includes(ch)) out.push('PP');
    else if ('fv'.includes(ch)) out.push('FF');
    else if ('szc'.includes(ch)) out.push('SS');
    else if ('tdnl'.includes(ch)) out.push('DD');
    else if ('kg'.includes(ch)) out.push('kk');
    else out.push('E');
  }
  return out;
}

/**
 * 按可用时间给一个音节的口型「抽稀」。
 *
 * 中文一个音节 150~250ms，声母+介音+韵腹+韵尾最多 4 个口型，每个只剩 40~60ms。
 * Morph 过渡本身就要几十毫秒，排得比这还密等于每帧都在切换、每个都到不了峰值。
 * 所以允许塞几个就塞几个：时间够就全排，不够就先丢韵尾、再丢介音，
 * 保住「声母（口型最明显）+ 韵腹（最响）」这两个真正听得出来的。
 */
function fitUnits(units: string[], spanMs: number): string[] {
  const budget = Math.max(1, Math.floor(spanMs / MIN_VISEME_MS));
  if (units.length <= budget) return units;
  // 韵腹是音节里最响、口型最明显的一个；有韵尾时它是倒数第二个
  const nucleus = units.length >= 2 ? units[units.length - 2]! : units[0]!;
  if (budget === 1) return [nucleus];
  // 声母 + 韵腹优先，还剩名额就把末尾的鼻音补上
  return [units[0]!, nucleus, ...(budget >= 3 ? [units[units.length - 1]!] : [])];
}

/**
 * 把词级时间戳展开成 viseme 时间线。
 *
 * 分两级分配时间：
 * 1. **词内按音节均分**——一个词里有几个字，就切成几段等长的时间窗。
 *    音节才是发音的基本单位，每个字念得差不多久。
 * 2. **音节内按音素均分**——声母、韵腹、韵尾依次占满这个音节的时间窗。
 *
 * 不能按「音素数量」均分整词时长：ian 有 3 个口型、a 只有 1 个，
 * 按音素分会把「面」拉得比「啊」长三倍，节奏就散了。
 *
 * 词与词之间的空隙不补 `sil`：TalkingHead 每个 viseme 的关键帧末尾都会
 * 归零到闭嘴，不排数据自然就是闭嘴，补了反而多出一堆冗余关键帧。
 */
export function buildVisemesFromWords(
  words: WordCue[],
  onsetMs = 0,
  envelope?: (ms: number) => number,
): {
  visemes: string[];
  vtimes: number[];
  vdurations: number[];
  /** 每个 viseme 对应的张口幅度（0..1），喂给 jawOpen */
  vaperture: number[];
} {
  const visemes: string[] = [];
  const vtimes: number[] = [];
  const vdurations: number[] = [];
  const vaperture: number[] = [];

  for (const word of words) {
    const syllables = textToSyllableVisemes(word.text);
    if (syllables.length === 0) continue;

    // 词边界的时间轴比音频早 onsetMs 开始；平的加过去就对齐了
    const start = word.offset + onsetMs;
    const duration = Math.max(word.duration, MIN_VISEME_MS * syllables.length);
    const sylStep = duration / syllables.length;

    syllables.forEach((units, s) => {
      const sylStart = start + s * sylStep;
      // 音节内能排几个口型由时间决定：塞不下就抽稀，而不是把每个都压到
      // MIN_VISEME_MS 以下。硬塞的下场是相邻 viseme 大幅重叠，Morph 互相
      // 抵消，嘴看起来只是「一直在微微蠕动」，反而更对不上。
      const fitted = fitUnits(units, sylStep);
      const step = sylStep / fitted.length;
      fitted.forEach((v, i) => {
        visemes.push(v);
        const at = sylStart + i * step;
        vtimes.push(at);
        vdurations.push(Math.min(MAX_VISEME_MS, Math.max(MIN_VISEME_MS, step * DUTY)));
        // 张口幅度取这一帧附近的真实音量。闭口音（PP/FF/sil）不能张，
        // 否则会出现「念 b 的时候嘴张得老大」。
        // 上限 0.45：再多下颌就转过头，舌头和口腔内壁的网格会翻出来，
        // 看起来像一直吐着舌头。0.45 已经足够看出在说话。
        const loud = envelope ? envelope(at) : 1;
        vaperture.push(/^(PP|FF|sil)$/.test(v) ? 0 : Math.min(0.45, 0.18 + 0.42 * loud));
      });
    });
  }

  return { visemes, vtimes, vdurations, vaperture };
}

/**
 * 把 viseme 排程送进 TalkingHead，并额外驱动 jawOpen。
 *
 * TalkingHead 的 streamAudio 只认 viseme（而且幅度写死 0.6），它不会动下颌。
 * 这个模型的 viseme morph 形变又偏保守，光靠它嘴几乎看不出在说话。
 * 所以 viseme 排程照常交给它，同时我们自己往 animQueue 里补一条 jawOpen 轨道，
 * 时间轴和 viseme 完全一致——两者叠起来才是「嘴张开了，而且形状对得上」。
 */
function streamWithAperture(
  head: TalkingHead,
  visemes: string[],
  vtimes: number[],
  vdurations: number[],
  vaperture: number[],
  audio: Int16Array,
): void {
  head.streamAudio({ audio, visemes, vtimes, vdurations });

  // streamAudio 发现还没开始播时，会把 viseme 排程塞进队列、等 worklet 回
  // playback-started 才取基准。首片音频必然走这条路径，所以基准晚一点才出现，
  // 不能直接 return，否则第一整段都是「有口型没张合」。
  const startOf = (): number | null =>
    (head as unknown as { streamAudioStartTime: number | null }).streamAudioStartTime ?? null;

  const push = (start: number): void => {
    const queue = (head as unknown as { animQueue: unknown[] }).animQueue;
    if (!queue) return;
    for (let i = 0; i < vtimes.length; i += 1) {
      const t = start + vtimes[i]!;
      const d = vdurations[i]!;
      const open = vaperture[i] ?? 0;
      queue.push({
        template: { name: 'viseme' },
        // 与 TalkingHead 给 viseme 的关键帧同样的形状：先起、到峰值、再收
        ts: [t - (2 * d) / 3, t + d / 2, t + d + d / 2],
        vs: { jawOpen: [null, open, 0] },
      });
    }
  };

  const start = startOf();
  if (start !== null) {
    push(start);
    return;
  }
  // 首次播放：轮询等基准。正常情况下 worklet 一两帧内就回，最多等 500ms。
  const deadline = performance.now() + 500;
  const poll = (): void => {
    const s = startOf();
    if (s !== null) {
      push(s);
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

/**
 * 兜底：没有词时间戳时按音量生成。
 *
 * 这条路径只保证「有声就动、没声就停」，口型形状和念的字无关，
 * 属于降级方案，不是主路径。
 */
export function buildVisemesFromAudio(buffer: AudioBuffer): {
  visemes: string[];
  vtimes: number[];
  vdurations: number[];
  vaperture: number[];
} {
  const WINDOW_MS = 50;
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.round((sr * WINDOW_MS) / 1000));

  const visemes: string[] = [];
  const vtimes: number[] = [];
  const vdurations: number[] = [];
  const vaperture: number[] = [];

  let loudRun = 0;
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j += 1) sum += data[j]! * data[j]!;
    const rms = Math.sqrt(sum / win);

    let viseme: string;
    if (rms < 0.008) {
      viseme = 'sil';
    } else if (rms < 0.035) {
      viseme = 'PP';
    } else if (rms < 0.09) {
      viseme = loudRun % 2 === 0 ? 'E' : 'I';
      loudRun += 1;
    } else if (rms < 0.16) {
      viseme = loudRun % 2 === 0 ? 'aa' : 'O';
      loudRun += 1;
    } else {
      viseme = 'aa';
      loudRun += 1;
    }

    visemes.push(viseme);
    vtimes.push((i / sr) * 1000);
    vdurations.push(WINDOW_MS);
    vaperture.push(viseme === 'sil' ? 0 : Math.min(1, 0.2 + rms * 4));
  }

  return { visemes, vtimes, vdurations, vaperture };
}

/**
 * 量出这一片音频真正开始出声的时刻（相对片段起点，ms）。
 *
 * TTS 的词边界是「引擎认为该念这个字了」，我们真正要的是「喇叭里真的出这个音了」。
 * 两者之间隔着 MP3 编码器延迟和播放器补的静音帧——实测解码后的波形比词边界
 * 晚 65~70ms。这个差值随引擎/采样率变，写死一个常量迟早会错，所以直接量。
 *
 * 按 10ms 窗算 RMS，取第一个超过峰值 6% 的窗。上限 400ms：真遇到整片静音
 * 也不能把整段口型推到没影的地方。
 */
function measureOnset(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.round(sr * 0.01));
  const rmsAt = (i: number): number => {
    let s = 0;
    const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j += 1) s += data[j]! * data[j]!;
    return Math.sqrt(s / win);
  };

  let peak = 0;
  for (let i = 0; i + win <= data.length; i += win) {
    const r = rmsAt(i);
    if (r > peak) peak = r;
  }
  if (peak < 0.005) return 0;

  const th = peak * 0.06;
  for (let i = 0; i + win <= data.length; i += win) {
    if (rmsAt(i) > th) return Math.min(400, (i / sr) * 1000);
  }
  return 0;
}

/**
 * 算出这一片音频的音量包络，用来决定「嘴张多大」。
 *
 * 光有 viseme 是不够的：Oculus 的 viseme morph 里 `aa` 只改变唇形，下颌几乎不动。
 * 实测把 viseme_aa 拉到 1.0，嘴仍然是抿着的样子；要真正「看得出来在说话」，
 * 必须同时推 jawOpen（下颚骨）。所以形状由 viseme 给、开合幅度由音量给。
 *
 * 返回一个按 20ms 分桶的归一化音量数组，值域 0..1（相对本段最响处）。
 */
function buildEnvelope(buffer: AudioBuffer): { at: (ms: number) => number; peak: number } {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.round(sr * 0.02));
  const buckets: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j += 1) s += data[j]! * data[j]!;
    buckets.push(Math.sqrt(s / win));
  }
  const peak = buckets.length ? Math.max(...buckets) : 0;
  const norm = peak > 0.001 ? peak : 1;

  const at = (ms: number): number => {
    const idx = Math.floor(ms / 20);
    if (idx < 0 || idx >= buckets.length) return 0;
    // 取邻域的软最大值：单个 20ms 桶会有抖动，取周围 ±1 桶更稳
    let v = buckets[idx]!;
    if (idx > 0) v = Math.max(v, buckets[idx - 1]!);
    if (idx + 1 < buckets.length) v = Math.max(v, buckets[idx + 1]!);
    return Math.min(1, v / norm);
  };
  return { at, peak };
}

export function createSpeechSink(options: SpeechSinkOptions): SpeechSink {
  let chunks: Uint8Array[] = [];
  let ctx: AudioContext | null = null;
  let streaming = false;
  let disposed = false;
  /** 正在建流：并发 flush 时要共用同一个 promise，否则会重复 streamStart */
  let starting: Promise<boolean> | null = null;
  /** 服务端已说「没有更多分片了」，但要等最后一个分片解码推完才能通知 */
  let pendingEnd = false;
  /**
   * 已推进 worklet 的音频总时长（毫秒）。
   *
   * streamAudio 的 viseme 时间轴是相对「整条流开始」的，而服务端一句一个分片、
   * 每片各自从 0 计时。第二片若不平移，口型会被排回第一片的位置。
   */
  let playedMs = 0;
  /** 当前分片的词时间戳，null 表示引擎没给，只能退回按音量生成 */
  let words: WordCue[] | null = null;

  /**
   * 解码用的 AudioContext 必须和 streamStart 的采样率一致。
   *
   * 用默认 48kHz 解码、再按 24kHz 回放，等于把音频拉慢一倍：音高掉一个八度
   * （女声听起来变男声）、语速减半、噪声被拉长听起来发糊。
   * decodeAudioData 会按所属 AudioContext 的采样率重采样，所以这里直接建 24k 的。
   */
  const SAMPLE_RATE = 24000;

  const getCtx = (): AudioContext => {
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      } catch {
        // 少数浏览器不支持指定采样率，退回默认；下面会检查并手工重采样
        ctx = new AudioContext();
      }
    }
    // resume 是异步的，期间上下文可能已经被关掉（StrictMode 重建实例），
    // 不接住就会冒一个 InvalidStateError
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };

  const ensureStream = (): Promise<boolean> => {
    const head = options.getHead();
    if (!head) return Promise.resolve(false);
    if (streaming) return Promise.resolve(true);
    if (starting) return starting;

    const task: Promise<boolean> = head
      // 采样率跟服务端的 mp3 一致，省掉一次重采样
      .streamStart(
        { sampleRate: 24000 },
        () => options.onStart?.(),
        () => {
          streaming = false;
          playedMs = 0;
          options.onEnd?.();
        },
      )
      .then(() => {
        if (disposed) return false;
        streaming = true;
        return true;
      })
      .catch((err: unknown) => {
        options.onError?.(err);
        return false;
      })
      .finally(() => {
        starting = null;
      });

    starting = task;
    return task;
  };

  return {
    push(bytes: Uint8Array): void {
      if (disposed) return;
      chunks.push(bytes.slice());
    },

    setWords(next: WordCue[]): void {
      words = next.length > 0 ? next : null;
    },

    flush(): void {
      if (disposed || chunks.length === 0) return;
      const merged = concat(chunks);
      chunks = [];
      if (merged.byteLength === 0) return;

      // 词时间戳只属于当前这一段，用完就清掉，避免串到下一句
      const segWords = words;
      words = null;

      // decodeAudioData 会接管（detach）传入的 ArrayBuffer，这里给一份独立的。
      // slice 出来的是 ArrayBufferLike，显式 new 一份避免 SharedArrayBuffer 类型
      const view = merged.subarray(merged.byteOffset, merged.byteOffset + merged.byteLength);
      const buf = new ArrayBuffer(view.byteLength);
      new Uint8Array(buf).set(view);

      void getCtx()
        .decodeAudioData(buf)
        .then(async (audioBuffer) => {
          if (disposed) return;
          const ok = await ensureStream();
          if (!ok || disposed) return;
          const head = options.getHead();
          if (!head) return;

          const offset = playedMs;
          // 词边界是「引擎时间轴」（首字恒在 100ms，那是引擎固定的前导静音），
          // 解码后的波形比它整体晚几十毫秒（MP3 编码器延迟 + 播放器补的静音帧）。
          // 两个时间轴的差就是「实测音头 - 首条词边界」，平的加过去就对上了。
          //
          // 再加 outputLatency：TalkingHead 在 worklet **收到**首块音频时就把
          // streamAudioStartTime 定成当前 animClock，可那时扬声器还没出声，
          // 真正播出来要再过几十毫秒。不补这一截，嘴还是比声音先动。
          const outputMs = (getCtx().outputLatency || 0) * 1000;
          const shift = segWords
            ? measureOnset(audioBuffer) - (segWords[0]?.offset ?? 0) + outputMs
            : outputMs;
          // 音量包络用于决定张嘴幅度（viseme 只管形状，不管开合大小）
          const env = buildEnvelope(audioBuffer);
          const vis = segWords
            ? buildVisemesFromWords(segWords, shift, env.at)
            : buildVisemesFromAudio(audioBuffer);
          streamWithAperture(
            head,
            vis.visemes,
            vis.vtimes.map((t) => t + offset),
            vis.vdurations,
            vis.vaperture,
            toPcm16(audioBuffer, SAMPLE_RATE),
          );
          playedMs += audioBuffer.duration * 1000;

          if (pendingEnd) {
            pendingEnd = false;
            try {
              head.streamNotifyEnd();
            } catch {
              /* 已经停了就忽略 */
            }
          }
        })
        .catch((err: unknown) => options.onError?.(err));
    },

    end(): void {
      chunks = [];
      const head = options.getHead();
      if (!head) return;
      // 还有分片在解码：等最后一片推完再通知，否则结尾会被截掉
      if (!streaming) {
        pendingEnd = true;
        return;
      }
      try {
        head.streamNotifyEnd();
      } catch {
        /* 已经停了就忽略 */
      }
    },

    abort(): void {
      chunks = [];
      words = null;
      pendingEnd = false;
      playedMs = 0;
      streaming = false;
      const head = options.getHead();
      if (!head) return;
      try {
        head.streamStop();
      } catch {
        /* ignore */
      }
    },
  };
}