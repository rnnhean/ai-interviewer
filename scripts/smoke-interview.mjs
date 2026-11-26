#!/usr/bin/env node
// 端到端冒烟：建会话 → 开场白 → 3 轮文字回答 → 结束 → 导出。
// 只打印状态码、耗时、事件类型与文本长度，绝不打印任何密钥或完整请求头。
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3101';
const ANSWERS = [
  '我做过一个基于 React 和 NestJS 的知识库项目，前端负责文档编辑器和检索页，后端负责分片、向量化和权限校验。',
  '检索这块我们是混合检索，BM25 做关键词、向量做语义，再用一个 rerank 模型重排，最后交给大模型做引用回答。',
  '我自己的定位是前端出身，现在在做 Agent 应用落地，包括工具调用编排、上下文管理和评测，暂时不做模型训练。',
];

const timings = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    timings.push({ name, ms: Date.now() - t0, ok: true });
    console.log(`✓ ${name}  ${Date.now() - t0}ms`);
    return result;
  } catch (err) {
    timings.push({ name, ms: Date.now() - t0, ok: false });
    console.log(`✗ ${name}  ${Date.now() - t0}ms`);
    throw err;
  }
}

/** 读 SSE 流，统计各类 chunk，返回最终文本 */
async function readStream(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('没有响应体');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  const types = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '' || payload === '[DONE]') continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      types.set(obj.type, (types.get(obj.type) ?? 0) + 1);
      if (obj.type === 'text-delta') text += obj.delta ?? '';
    }
  }

  return { text: text.trim(), types };
}

function summarize(types) {
  return [...types.entries()]
    .filter(([k]) => k !== 'text-delta' && k !== 'text-start' && k !== 'text-end' && k !== 'start' && k !== 'finish')
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
}

async function main() {
  const health = await step('后端可达', async () => {
    const res = await fetch(`${BASE}/api/interview/__smoke__`);
    if (res.status !== 404) throw new Error(`预期 404，实际 ${res.status}`);
    return true;
  });
  void health;

  const created = await step('创建会话', async () => {
    const res = await fetch(`${BASE}/api/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track: 'frontend-to-agent', atmosphere: 'standard', durationMin: 25 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  const id = created.id;
  console.log(`  会话 ${id.slice(0, 8)}…`);

  const opening = await step('生成开场白', async () => {
    const res = await fetch(`${BASE}/api/interview/${id}/opening`, { method: 'POST' });
    return readStream(res);
  });
  if (opening.text === '') throw new Error('开场白为空');
  console.log(`  ${opening.text.length} 字  [${summarize(opening.types)}]`);

  for (const [i, answer] of ANSWERS.entries()) {
    const turn = await step(`第 ${i + 1} 轮问答`, async () => {
      const res = await fetch(`${BASE}/api/interview/${id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: answer, source: 'text' }),
      });
      return readStream(res);
    });
    if (turn.text === '') throw new Error(`第 ${i + 1} 轮没有返回文本`);
    console.log(`  ${turn.text.length} 字  [${summarize(turn.types)}]`);
    await sleep(300);
  }

  const snapshot = await step('会话快照', async () => {
    const res = await fetch(`${BASE}/api/interview/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  console.log(`  轮次 ${snapshot.rounds.length}，阶段 ${snapshot.phase}`);

  const report = await step('生成评价', async () => {
    const res = await fetch(`${BASE}/api/interview/${id}/finish`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.snapshot?.report) throw new Error('没有拿到评价');
    return body.snapshot.report;
  });
  console.log(
    `  总分 ${report.total}，维度 ${report.dimensions?.length ?? 0} 个，待提高 ${report.actions?.length ?? 0} 条${
      report.fallback ? '（降级报告）' : ''
    }`,
  );

  for (const format of ['md', 'json']) {
    const res = await step(`导出 ${format}`, async () => {
      const r = await fetch(`${BASE}/api/interview/${id}/export?format=${format}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (text.trim() === '') throw new Error('导出内容为空');
      return text;
    });
    console.log(`  长度 ${res.length}`);
  }

  const total = timings.reduce((sum, t) => sum + t.ms, 0);
  console.log(`\n全部通过，总耗时 ${(total / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(`\n冒烟失败：${err instanceof Error ? err.message : String(err)}`);
  console.error('已完成步骤：');
  for (const t of timings) console.log(`  ${t.ok ? '✓' : '✗'} ${t.name}  ${t.ms}ms`);
  process.exitCode = 1;
});
