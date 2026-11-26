import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtsPlayer } from './tts-player';

/** 最小的 Audio 桩：记录 pause / play 调用，事件能手动触发 */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  autoplay = false;
  preload = '';
  currentTime = 0;
  paused = true;
  playCalls = 0;
  private listeners = new Map<string, Array<() => void>>();

  constructor(src?: string) {
    if (src) this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  play(): Promise<void> {
    this.playCalls += 1;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(): void {
    this.src = '';
  }

  load(): void {
    /* noop */
  }
}

describe('tts-player（blob 兜底路径）', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    // 没有 MSE → 走 blob
    vi.stubGlobal('MediaSource', undefined);
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('攒满一轮再播放，onStart 只在真正播放时触发', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const player = createTtsPlayer({ onStart, onEnd });

    player.push(new Uint8Array([1, 2, 3]));
    expect(FakeAudio.instances).toHaveLength(0);
    expect(onStart).not.toHaveBeenCalled();

    player.end();
    expect(FakeAudio.instances).toHaveLength(1);

    FakeAudio.instances[0]!.emit('playing');
    expect(onStart).toHaveBeenCalledTimes(1);

    FakeAudio.instances[0]!.emit('ended');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('abort 之后不再播放，也不触发 onStart', () => {
    const onStart = vi.fn();
    const player = createTtsPlayer({ onStart });
    player.push(new Uint8Array([1]));
    player.abort();
    player.end();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('播放中被 abort 会立即 pause', () => {
    const player = createTtsPlayer({});
    player.push(new Uint8Array([1]));
    player.end();
    const audio = FakeAudio.instances[0]!;
    audio.emit('playing');
    player.abort();
    expect(audio.paused).toBe(true);
  });

  it('没有音频时 end 不建播放器', () => {
    const player = createTtsPlayer({});
    player.end();
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
