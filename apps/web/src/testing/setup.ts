import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// antd 组件依赖 matchMedia / ResizeObserver，jsdom 里没有
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// Node 20 没有 Map.groupBy，vitest 5 的错误报告器会用到
if (typeof (Map as unknown as { groupBy?: unknown }).groupBy !== 'function') {
  (Map as unknown as { groupBy: <T, K>(items: Iterable<T>, fn: (item: T) => K) => Map<K, T[]> }).groupBy = <T, K>(
    items: Iterable<T>,
    fn: (item: T) => K,
  ): Map<K, T[]> => {
    const out = new Map<K, T[]>();
    for (const item of items) {
      const key = fn(item);
      const list = out.get(key);
      if (list) list.push(item);
      else out.set(key, [item]);
    }
    return out;
  };
}
