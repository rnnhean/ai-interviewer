#!/usr/bin/env node
// 把 @ricky0123/vad-web 与 onnxruntime-web 运行时需要的静态资源复制到
// apps/web/public/vad/。public/vad/ 在 .gitignore 里，所以新克隆的仓库
// 必须跑一次这个脚本，否则麦克风按钮点下去 VAD 加载会 404。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEST = path.join(ROOT, 'apps/web/public/vad');

const require = createRequire(path.join(ROOT, 'apps/web/package.json'));

/** 依次尝试几个入口，找到包的实际目录（pnpm 的目录层级会变） */
function pkgDir(specifier, entry) {
  try {
    const resolved = require.resolve(entry, { paths: [path.join(ROOT, 'apps/web')] });
    void specifier;
    return path.dirname(resolved);
  } catch {
    return null;
  }
}

/**
 * onnxruntime-web 是 vad-web 的传递依赖，不是 apps/web 的直接依赖，
 * require.resolve 解析不到。从 vad-web 的所在目录逐级往上找。
 */
function findUp(startDir, rel) {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'node_modules', rel);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const vadDir = pkgDir('@ricky0123/vad-web', '@ricky0123/vad-web/dist/index.js');
const ortDir = vadDir
  ? findUp(vadDir, path.join('onnxruntime-web', 'dist'))
  : findUp(path.join(ROOT, 'apps/web'), path.join('onnxruntime-web', 'dist'));

const jobs = [];

if (vadDir) {
  for (const f of ['silero_vad_v5.onnx', 'silero_vad_legacy.onnx', 'vad.worklet.bundle.min.js']) {
    jobs.push([path.join(vadDir, f), f]);
  }
} else {
  console.error('找不到 @ricky0123/vad-web，先跑 pnpm install');
  process.exitCode = 1;
}

if (ortDir) {
  jobs.push([path.join(ortDir, 'ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs']);
  jobs.push([path.join(ortDir, 'ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm']);
} else {
  console.error('找不到 onnxruntime-web，先跑 pnpm install');
  process.exitCode = 1;
}

fs.mkdirSync(DEST, { recursive: true });

let copied = 0;
for (const [src, name] of jobs) {
  const dest = path.join(DEST, name);
  if (!fs.existsSync(src)) {
    console.warn(`  跳过（源文件不存在）：${name}`);
    continue;
  }
  // 已存在且大小一致就不重复拷，14MB 的 wasm 每次拷很慢
  if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) {
    console.log(`  已是最新：${name}`);
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log(`  已复制：${name}`);
  copied += 1;
}

console.log(`\nVAD 资源就绪：${path.relative(ROOT, DEST)}（本次复制 ${copied} 个）`);
