import { useEffect, useRef, useState } from 'react';
import { TalkingHead } from '@met4citizen/talkinghead';
import type { DigitalAvatarHandle } from '../features/voice/useTtsSocket';

export interface DigitalHumanProps {
  /** 面试官是否正在说话 */
  speaking: boolean;
  /** 显示在画面下方的状态文案 */
  label?: string;
  /**
   * 模型加载完成后回传句柄。TTS 层拿到它就把音频改成流式口型输出，
   * 拿不到时退回普通播放器，所以加载期间也不会没声音。
   */
  onReady?: (handle: DigitalAvatarHandle) => void;
}

/** 默认面试官模型：avaturn 是真人风、面部细节和口型形变都完整的那个 */
const AVATAR_URL = '/avatar/avaturn.glb';

/** ?avatar=vroid 可以临时换模型，方便对比挑人选 */
function resolveAvatarUrl(): string {
  const q = new URLSearchParams(globalThis.location.search).get('avatar');
  return q ? `/avatar/${q}.glb` : AVATAR_URL;
}

/**
 * TalkingHead 的流式口型把每个 viseme 的峰值**写死**成 0.6（PP/FF 是 0.9），
 * 没有对外的幅度参数。这个 avaturn 模型在 0.6 时嘴几乎看不出动，
 * 拉到 1.0 才是有说服力的张口幅度（已用固定 morph 逐档截图对比确认）。
 *
 * `mtAvatar[name].limit` 是它内部唯一能改写「最终施加值」的钩子：
 * updateMorphTargets 里 `o.applied = o.limit(o.value)`，改这里不会碰动画时间轴，
 * 只把幅度放大到接近满量程。1.58 倍让 0.6 落到 0.95，PP/FF 的 0.9 直接到顶。
 */
const VISEME_GAIN = 1.58;

function amplifyVisemes(head: TalkingHead): void {
  const table = (head as unknown as {
    mtAvatar?: Record<string, { limit: ((v: number) => number) | null }>;
  }).mtAvatar;
  if (!table) return;
  for (const key of Object.keys(table)) {
    if (!key.startsWith('viseme_')) continue;
    table[key]!.limit = (v: number) => Math.max(0, Math.min(1, v * VISEME_GAIN));
  }
}

/**
 * 数字人面试官。
 *
 * 用 TalkingHead（MIT，3D + 实时口型同步）而不是手写 SVG/CSS：
 * 模型、骨骼、眨眼、呼吸、口型都由它驱动，我们只负责喂音频。
 *
 * 视图固定在头部特写（cameraView: 'head'），这是面试场景该有的机位。
 */
export function DigitalHuman({ speaking, label, onReady }: DigitalHumanProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<TalkingHead | null>(null);
  /** onReady 可能每次渲染都是新函数，用 ref 存最新值，避免重建 3D 场景 */
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let head: TalkingHead | null = null;

    try {
      head = new TalkingHead(host, {
        cameraView: 'head',
        // 默认机位贴得太近，下巴和肩都被裁在画面外；拉远并抬高视线，
        // 让「头 + 肩」完整落在舞台里。cameraY 越小机位越低，人像越靠上；
        // 竖栏画面很窄（约 1:3），人像要靠相机距离框进来。
        // 下面三个值是按实测头骨世界坐标 x=0.059 / y=1.669 反推的：
        // view='head' 时内部把距离再加 2、视线抬到头高 4/5 处，
        // 所以 cameraX/cameraY 不是「平移多少」，而是相对这个默认瞄准点的偏移。
        cameraDistance: 1.75,
        cameraY: 0.354,
        cameraX: -0.18,
        modelFPS: 30,
        lipsyncModules: ['en'],
        // 画面已经由 CSS 控制尺寸，这里只保证渲染分辨率跟得上
        modelPixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 2),
        cameraRotateEnable: false,
        cameraPanEnable: false,
        // 面试场景要一直看着候选人：idle 时少晃头、多对视
        avatarIdleHeadMove: 0.25,
        avatarIdleEyeContact: 0.9,
        avatarSpeakingHeadMove: 0.35,
      });
      headRef.current = head;
      // 调试用：只在 dev 下挂到全局，方便在控制台/e2e 里读口型 morph。
      // 每次新建实例都覆盖，避免拿到 StrictMode 丢弃的旧实例。
      if (import.meta.env.DEV) {
        const g = globalThis as { __talkingHead?: TalkingHead; __heads?: TalkingHead[] };
        (g.__heads ??= []).push(head);
        g.__talkingHead = head;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    head
      .showAvatar({ url: resolveAvatarUrl(), body: 'F', lipsyncLang: 'en' })
      .then(() => {
        if (disposed) return;
        // mtAvatar 要等模型加载完才建好，所以放在这里而不是构造之后
        amplifyVisemes(head!);
        setReady(true);
        (globalThis as { __avatarModel?: string }).__avatarModel = resolveAvatarUrl();
        // 闭包里捕获的是**这个**已经加载完的实例。挂在 ref 上会指向
        // StrictMode 第二次挂载出来的新实例，而它的模型可能还没 load 完，
        // streamStart 读 this.avatar.lipsyncLang 就会抛 undefined。
        onReadyRef.current?.({ getHead: () => (disposed ? null : head) });
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      if (headRef.current === head) headRef.current = null;
      // 调试指针不能留在被丢弃的实例上，否则在控制台/脚本里读到的是个死的
      const dbg = globalThis as { __talkingHead?: TalkingHead };
      if (dbg.__talkingHead === head) delete dbg.__talkingHead;
      try {
        // 必须 dispose：否则 StrictMode 的两次挂载会在同一个 host 里
        // 留下两个 canvas 和两套 WebGL 上下文
        head?.dispose?.();
      } catch {
        /* 卸载阶段忽略 */
      }
    };
  }, []);

  return (
    <div className="human" data-testid="digital-human">
      <div className="human__viewport" ref={hostRef} />
      {!ready && !error && <div className="human__hint">数字人加载中…</div>}
      {error && <div className="human__hint human__hint--error">数字人加载失败：{error}</div>}
      <div className="human__meta">
        <span className="human__name">面试官</span>
        <span className={`human__status${speaking ? ' human__status--on' : ''}`}>
          {label ?? (speaking ? '正在说话' : '待命')}
        </span>
      </div>
    </div>
  );
}