#!/usr/bin/env node
// 从腾讯云 SecretKey.csv 与 knowledge-hub-backend/.env 生成 apps/server/.env。
// 本脚本在任何分支都不打印任何密钥值，只打印键名。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const CSV_PATH = 'C:/Users/v-renhan/Downloads/SecretKey.csv';
const KH_ENV_PATH = 'D:/20260916/knowledge-hub-backend/.env';
const TARGET = path.join(ROOT, 'apps/server/.env');

const DEFAULTS = {
  LLM_API_KEY: '',
  LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  LLM_MODEL: 'qwen-plus',
  TENCENT_SECRET_ID: '',
  TENCENT_SECRET_KEY: '',
  TENCENT_APP_ID: '1312591814',
  TENCENT_ASR_ENGINE: '16k_zh',
  ASR_CORRECTION_MODEL: 'qwen3-asr-flash',
  TTS_PROVIDER: 'edge',
  EDGE_TTS_VOICE: 'zh-CN-XiaoxiaoNeural',
  TTS_FALLBACK_PROVIDER: 'dashscope',
  DASHSCOPE_TTS_VOICE: 'longxiaochun_v2',
  SPEECH_MODE: 'mock',
  PORT: '3101',
};

function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function readCsv(pathname) {
  if (!fs.existsSync(pathname)) return { ok: false, reason: '文件不存在' };
  const text = fs.readFileSync(pathname, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const [header, ...rows] = lines;
  if (!header || rows.length === 0) return { ok: false, reason: '文件为空或只有表头' };
  const cols = header.split(',').map((s) => s.trim());
  const vals = rows[0].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  const rec = {};
  cols.forEach((c, i) => {
    rec[c] = vals[i] ?? '';
  });
  return { ok: true, rec };
}

const missingSources = [];
const resolved = { ...DEFAULTS };
const filledBy = {};

// 1) 腾讯云密钥
const csv = readCsv(CSV_PATH);
if (csv.ok) {
  if (csv.rec.SecretId) {
    resolved.TENCENT_SECRET_ID = csv.rec.SecretId;
    filledBy.TENCENT_SECRET_ID = 'SecretKey.csv';
  }
  if (csv.rec.SecretKey) {
    resolved.TENCENT_SECRET_KEY = csv.rec.SecretKey;
    filledBy.TENCENT_SECRET_KEY = 'SecretKey.csv';
  }
} else {
  missingSources.push(`腾讯密钥 CSV（${csv.reason}）`);
}

// 2) LLM Key
if (fs.existsSync(KH_ENV_PATH)) {
  const kh = parseDotEnv(fs.readFileSync(KH_ENV_PATH, 'utf8'));
  const key = kh.OPENAI_API_KEY || kh.DASHSCOPE_API_KEY || '';
  if (key) {
    resolved.LLM_API_KEY = key;
    filledBy.LLM_API_KEY = 'knowledge-hub-backend/.env';
  } else {
    missingSources.push('knowledge-hub-backend/.env 中未找到 OPENAI_API_KEY');
  }
} else {
  missingSources.push('knowledge-hub-backend/.env 不存在');
}

// 3) 已存在的 .env 优先（不覆盖用户手改过的值）
if (fs.existsSync(TARGET)) {
  const existing = parseDotEnv(fs.readFileSync(TARGET, 'utf8'));
  for (const [k, v] of Object.entries(existing)) {
    if (v !== '') {
      resolved[k] = v;
      filledBy[k] = '已有 .env';
    }
  }
}

const empty = Object.entries(resolved)
  .filter(([, v]) => v === '')
  .map(([k]) => k);

const body =
  [
    '# 本文件由 scripts/setup-env.mjs 生成，包含真实凭据，不要提交、不要外发。',
    '# 如需修改，直接编辑后重新运行脚本：已有值不会被覆盖。',
    '',
  ]
    .concat(Object.entries(resolved).map(([k, v]) => `${k}=${v}`))
    .join('\n') + '\n';

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
const isNew = !fs.existsSync(TARGET);
fs.writeFileSync(TARGET, body, { encoding: 'utf8', mode: 0o600 });

// ── 输出：只有键名，永远没有值 ───────────────────────────
console.log(`\n${isNew ? '已创建' : '已更新'}：${path.relative(ROOT, TARGET)}`);
console.log(`共 ${Object.keys(resolved).length} 个键。`);

const fromSources = Object.entries(filledBy).filter(([, src]) => src !== '已有 .env');
if (fromSources.length > 0) {
  console.log('\n从外部来源写入的键：');
  for (const [k, src] of fromSources) console.log(`  ${k}  ←  ${src}`);
}

if (missingSources.length > 0) {
  console.log('\n以下来源不可用：');
  for (const s of missingSources) console.log(`  · ${s}`);
}

if (empty.length > 0) {
  console.log('\n以下键仍为空，需要手动填写：');
  for (const k of empty) console.log(`  · ${k}`);
  process.exitCode = 2;
} else {
  console.log('\n所有键都已填充。');
}
