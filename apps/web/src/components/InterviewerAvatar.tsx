import { useId, useMemo } from 'react';
import { createAvatar } from '@dicebear/core';
import { micah } from '@dicebear/collection';

export interface InterviewerAvatarProps {
  speaking: boolean;
  /** 实时音量 0–1，驱动光环与音量条；拿不到就传 0 */
  level?: number;
  /** 显示在名字下面的状态文案 */
  label?: string;
}

/** 音量条数量，够看出节奏即可 */
const BAR_COUNT = 5;

/**
 * DiceBear 把嘴画成一条微笑弧线，是死的不动的。
 *
 * 这里把它换成一组可缩放的「口腔 + 舌头」：闭嘴时纵向压成一条线（跟原来的
 * 微笑弧重合），张嘴时按实时音量纵向拉伸。坐标取自原弧线：
 * `M-.5 17.5c2.5 17 31 25 57 5.5`，即在 translate(170 183) 组里的
 * x ∈ [-0.5, 56.5]、y ∈ [17.5, 34]。
 */
const MOUTH_ORIGINAL =
  '<g transform="translate(170 183)"><path d="M-.5 17.5c2.5 17 31 25 57 5.5" stroke="#000000" stroke-width="4"/></g>';

const MOUTH_ANIMATED = [
  '<g transform="translate(170 183)">',
  // 说话时才露出来的口腔；纵向缩放由 CSS 的 --level 驱动
  '<g class="mouth-open">',
  '<ellipse cx="28" cy="27" rx="28.5" ry="12.5" fill="#431f18"/>',
  '<ellipse cx="28" cy="31" rx="16" ry="6.5" fill="#c2665c"/>',
  '</g>',
  // 闭嘴时的微笑弧，张嘴时淡出
  '<path class="mouth-line" d="M-.5 17.5c2.5 17 31 25 57 5.5" stroke="#000000" stroke-width="4" fill="none"/>',
  '</g>',
].join('');

/**
 * 面试官形象固定成这一套，不用随机 seed 抽：
 * 黑发 + 圆框眼镜 + 蓝衬衫 + 微笑，看着像个技术面试官。
 *
 * 形象本身来自 DiceBear（Draftbit Personas 风格），不是手画 SVG——
 * 手画的几个圆点根本不像人。
 *
 * 选项写成内联字面量，为的是让 TS 按 `createAvatar` 的形参上下文推断出
 * 字面量联合类型；先抽成常量会退化成 string[]，过不了类型检查。
 */
function buildInterviewerFace(): string {
  const svg = createAvatar(micah, {
    seed: 'ai-interviewer-han',
    size: 192,
    backgroundColor: ['eef2ff'],
    hair: ['full'],
    hairColor: ['2c2c2c'],
    shirt: ['collared'],
    shirtColor: ['3b5bdb'],
    eyes: ['eyes'],
    eyebrows: ['up'],
    mouth: ['smile'],
    nose: ['curve'],
    glasses: ['round'],
    glassesColor: ['343a40'],
    glassesProbability: 100,
    facialHairProbability: 0,
    earringsProbability: 0,
  }).toString();

  // metadata 里是一段 rdf 版权声明，跟显示无关，去掉省 DOM。
  // 嘴的替换如果没命中（库升级改了路径），保留原样即可，不至于整张图坏掉。
  return svg.replace(/<metadata[\s\S]*?<\/metadata>/, '').replace(MOUTH_ORIGINAL, MOUTH_ANIMATED);
}

/**
 * DiceBear 输出的内部 id 是固定名字（`viewboxMask` 等），
 * 同一个页面上放两个头像时，后一个的 `url(#viewboxMask)` 会解析到前一个的节点，
 * 于是被按错误尺寸裁掉、整张图变空白。加实例前缀隔离。
 */
function scopeSvgIds(svg: string, scope: string): string {
  return svg
    .replace(/id="([^"]+)"/g, (_, id: string) => `id="${scope}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${scope}-${id})`)
    .replace(/href="#([^"]+)"/g, (_, id: string) => `href="#${scope}-${id}"`);
}

/**
 * 数字人面试官。
 *
 * 形象是 DiceBear 生成的 2D 头像，说话时的「在讲」靠三样东西表达：
 * - 外圈光环随实时音量扩散（level 驱动半径与透明度）；
 * - 头像轻微上下浮动 + 按音量微放大；
 * - 旁边五根音量条跳动。
 *
 * 不做逐帧口型：这套插画的嘴只有 smile / surprised 这类整表情，
 * 没有「半张嘴」的中间态，硬切会变成脸在抽搐，比不动更难看。
 *
 * 拿不到音量（浏览器不支持 AnalyserNode、或用的是兜底朗读）时 level 恒为 0，
 * 光环退到最小、音量条贴底，浮动动画照常，仍然是「在说话」。
 */
export function InterviewerAvatar({ speaking, level = 0, label }: InterviewerAvatarProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, level));
  // 在说话、但一路拿不到音量（AnalyserNode 不可用 / 兜底朗读）时，
  // 嘴改由 CSS 按固定节奏开合，别让脸僵在那儿
  const silent = speaking && clamped < 0.02;
  const rawId = useId();
  const scope = useMemo(() => `iv${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);

  const faceSvg = useMemo(
    () =>
      scopeSvgIds(
        // metadata 里是一段 rdf 版权声明，跟显示无关，去掉省 DOM
        buildInterviewerFace().replace(/<metadata[\s\S]*?<\/metadata>/, ''),
        scope,
      ),
    [scope],
  );

  return (
    <div className={`avatar${speaking ? ' avatar--speaking' : ''}`} data-testid="interviewer-avatar">
      <div
        className={`avatar__face-wrap${silent ? ' avatar__face-wrap--silent' : ''}`}
        data-testid="interviewer-face"
        // 用 CSS 变量把音量递到样式层，避免每帧改 inline transform
        style={{ '--level': clamped.toFixed(3) } as React.CSSProperties}
        aria-hidden
      >
        <div className="avatar__face" dangerouslySetInnerHTML={{ __html: faceSvg }} />
      </div>

      <div className="avatar__meta">
        <div className="avatar__name">面试官</div>
        <div className="avatar__status">{label ?? (speaking ? '正在说话' : '待命')}</div>
      </div>

      {speaking && (
        <div className="avatar__meter" data-testid="interviewer-meter" aria-hidden>
          {Array.from({ length: BAR_COUNT }, (_, i) => {
            // 中间几根更高，两侧更矮，看起来像一段语音波形
            const shape = 0.45 + Math.sin(((i + 1) / (BAR_COUNT + 1)) * Math.PI) * 0.55;
            const height = 5 + clamped * 21 * shape;
            return <span key={i} className="avatar__bar" style={{ height: `${height.toFixed(1)}px` }} />;
          })}
        </div>
      )}
    </div>
  );
}