import { defineConfig } from 'vitest/config';

// node 20 没有 Map.groupBy，vitest 5 的错误报告器会用；不补的话
// 只要有一个用例失败，汇总阶段就再抛一次，把真实错误盖掉
if (typeof (Map as unknown as { groupBy?: unknown }).groupBy !== 'function') {
  Object.defineProperty(Map, 'groupBy', {
    value: function groupBy<T, K>(items: Iterable<T>, fn: (item: T) => K): Map<K, T[]> {
      const out = new Map<K, T[]>();
      for (const item of items) {
        const key = fn(item);
        const list = out.get(key);
        if (list) list.push(item);
        else out.set(key, [item]);
      }
      return out;
    },
    writable: true,
    configurable: true,
  });
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
  },
});
