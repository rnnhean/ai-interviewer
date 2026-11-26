/// <reference types="vitest" />
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// node 20 没有 Map.groupBy，vitest 5 的错误报告器会用；setupFiles 只在
// worker 里执行，主进程报错时仍会挂，所以这里也补一份
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

/**
 * onnxruntime-web 在运行时 `import()` 加载 `ort-wasm-simd-threaded.mjs`。
 * 这个文件在 public 下，vite 会拒绝 transform 它（"should not be imported
 * from source code"），于是 VAD 整个加载失败。这里在 vite 内部中间件之前
 * 直接按静态文件返回，绕开 transform。
 */
function serveVadEsm(): Plugin {
  const makeHandler = (dir: string) => (
    req: { url?: string },
    res: NodeJS.WritableStream & { setHeader?: Function; end?: Function },
    next: () => void,
  ) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.endsWith('.mjs')) return next();
    const file = path.join(dir, path.basename(url));
    if (!fs.existsSync(file)) return next();
    res.setHeader?.('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader?.('Cache-Control', 'no-cache');
    res.end?.(fs.readFileSync(file));
  };

  return {
    name: 'serve-vad-esm',
    // publicDir 由 vite 解析成绝对路径，省得自己拼 __dirname
    configureServer(server) {
      server.middlewares.use('/vad', makeHandler(path.join(server.config.publicDir, 'vad')));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/vad', makeHandler(path.join(server.config.publicDir, 'vad')));
    },
  };
}

export default defineConfig({
  plugins: [react(), serveVadEsm()],
  optimizeDeps: {
    // TalkingHead 用相对路径动态 import 自己的 lipsync / worklet 子模块，
    // 被 vite 预打包后这些路径会变成 .vite/deps/ 下的假地址，运行时报 404
    exclude: ['@met4citizen/talkinghead'],
  },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:3101', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3101', ws: true },
    },
  },
  /* VAD 的 onnxruntime 仍需 vite 预构建才能拿到 ESM 命名导出，不要 exclude */
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/testing/setup.ts'],
    css: false,
    // antd + echarts 首屏渲染在 jsdom 里偏慢，默认 5s 不够
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
