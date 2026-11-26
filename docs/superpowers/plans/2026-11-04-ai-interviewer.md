# AI 数字人面试官 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一个本地的语音/文字双通道模拟面试应用：AI 面试官按阶段追问、实时显示用户语音字幕、流式语音播报，结束后生成五维评价报告并可导出 Markdown/JSON。

**Architecture:** pnpm monorepo，`packages/shared` 放类型/常量/题库/状态机纯函数，`apps/server` 是 NestJS 服务（会话内存态、LLM 编排、腾讯实时 ASR 适配、msedge-tts 转发、报告、导出），`apps/web` 是 React + Vite 单页应用（`useChat` 收 SSE、`MicVAD` 取音、MediaSource 播流）。所有跨端类型来自 `@ai-interviewer/shared`，服务端持有全部业务状态，浏览器只做渲染与采集。

**Tech Stack:** React 19.3.1 / TypeScript 5.9.3 / Vite 8.3.5 / Ant Design 6.7.0 / Zustand 5.0.16 / ECharts 6.1.0 / ai 7.0.162 + @ai-sdk/react 4.0.166 + @ai-sdk/openai-compatible 3.0.84 / NestJS 12.3.2 / ws 8 / msedge-tts 2.1.1 / @ricky0123/vad-web 0.0.31 / mse-audio-wrapper 1.4.15 / file-saver 2.0.5 / wavefile 11.0.0 / reconnecting-websocket 4.4.0 / zod 4.6.7 / vitest 5.1.0。

**Spec:** `D:\20260916\ai-interviewer-design.md`

## Global Constraints

- 运行环境 Node **20.19.5**。本机 bash 默认 `node` 是 16.20.2，所有命令前置 `export PATH="/c/Users/v-renhan/AppData/Local/nvm/v20.19.5:$PATH"`。仓库根放 `.nvmrc`，内容 `20.19.5`。
- 包管理器 pnpm 8.7.1；workspace 包名 `@ai-interviewer/shared` / `@ai-interviewer/server` / `@ai-interviewer/web`。
- **不落库**：所有面试状态只在服务端进程内存 Map 里；进程重启或页面刷新即丢失，页面必须提示。
- **密钥**：只从 `apps/server/.env` 读；`.env` 进 `.gitignore`；启动日志只打印「已配置 / 缺失」，任何日志、错误响应、导出文件、前端可见文本都不得出现密钥值。写入 `.env` 的脚本不得回显值。
- **不执行任何 git 操作**（本目录当前不是 git 仓库，且未经使用者明确授权不得 commit/push）。计划每节末尾的「检查点」是跑测试与类型检查，不是提交。
- 语音模式开关 `SPEECH_MODE=mock|live`：`mock` 走内置脚本音频/文本，不消耗腾讯额度；`live` 才连真实腾讯实时 ASR。
- 固定数值（实现时必须逐字使用）：单段静音切句 **800ms**；段长上限 **15s**；一轮提交静音 **2.5s**；一轮硬上限 **90s**；催促阈值 温和/标准/压力 = **120s / 90s / 60s**；术语归一超时 **800ms**；打断判定连续能量 **300ms**；追问上限 温和/标准/压力 = **1 / 2 / 3** 层。
- 阶段题量区间：intro 1–2、project 3–5、fundamentals 2–4、scenario 2–3、reverse 1。
- 面试官口播约束：**2–4 句**、先给结论、不讲课、一次只问一个问题。
- 术语归一与终稿互不阻塞：「停顿后 1.5s 出终稿」只算 ASR 终稿，不含归一。
- 只允许 `pnpm add` 已列出的依赖；不要引入 UI 组件库替换 Ant Design，不要引入状态库替换 Zustand。

## Review Focus

按最可能出现的顺序，这五类输入/时机是规约没写细但一定会遇到的，每条都必须在对应任务的测试里钉住：

1. **模型漏输出或写坏 `<<CTRL>>` 控制行** —— 控制行绝不能漏进字幕、TTS 或导出文件；服务端必须按剩余题量兜底推进（Task 4、Task 6）。
2. **VAD 误触发产生的空回答 / 纯标点回答** —— 不得提交空轮次、不得触发 LLM 调用（Task 17）。
3. **说话中途被打断** —— 半句话要保留并标记「被打断」，且不能与后续回答重复拼接（Task 7、Task 14、Task 18）。
4. **评审题里的代码块被朗读** —— TTS 只能拿到 `speechText`，`displayText` 里的代码块必须剥掉（Task 5、Task 13）。
5. **没有报告时就点导出，或报告还在生成** —— 导出不能崩，必须降级为「报告未生成」并保留 transcript（Task 9）。

---

## 文件结构

```
ai-interviewer/
├─ package.json                  # workspace 根，统一 dev/test/typecheck 脚本
├─ pnpm-workspace.yaml
├─ .nvmrc  .gitignore  README.md
├─ scripts/setup-env.mjs         # 从 CSV + knowledge-hub .env 生成 apps/server/.env，不回显
├─ packages/shared/src/
│   ├─ types.ts                  # 跨端类型：会话、轮次、报告、UI 消息 data parts
│   ├─ limits.ts                 # 全部固定数值 + 阶段计划 + 兜底决策
│   ├─ report-schema.ts          # zod schema 与 InterviewReport 类型
│   ├─ question-bank.ts          # 预置题包（displayText / speechText）
│   ├─ wire.ts                   # /ws/asr 与 /ws/tts 的消息类型
│   ├─ nudge.ts                  # 三档催促话术
│   └─ index.ts
├─ apps/server/src/
│   ├─ main.ts  app.module.ts
│   ├─ config/env.ts  config/config.module.ts
│   ├─ llm/llm.module.ts  llm/llm.service.ts
│   ├─ llm/director-parser.ts    # <<CTRL>> 流式解析
│   ├─ llm/prompts.ts            # system prompt 组装（含三档氛围矩阵）
│   ├─ interview/session.store.ts
│   ├─ interview/interview.service.ts
│   ├─ interview/turn.service.ts # 单轮：解析控制行 → 推 SSE → 喂 TTS
│   ├─ interview/interview.controller.ts
│   ├─ report/report.service.ts
│   ├─ export/export.service.ts  export/export.controller.ts
│   ├─ asr/tencent-asr.client.ts asr/asr.gateway.ts
│   ├─ asr/correction.service.ts asr/normalizer.service.ts
│   ├─ tts/sentence-splitter.ts  tts/tts.service.ts
│   ├─ tts/dashscope-tts.ts      tts/tts.gateway.ts
│   └─ common/logger.ts          # 统一脱敏日志
└─ apps/web/src/
    ├─ main.tsx  App.tsx
    ├─ api/client.ts
    ├─ pages/SetupPage.tsx  pages/InterviewPage.tsx  pages/ReportPage.tsx
    ├─ features/chat/useInterviewChat.ts  features/chat/messageText.ts
    ├─ features/voice/turn-assembler.ts  features/voice/pcm.ts
    ├─ features/voice/useMicVad.ts       features/voice/useAsrSocket.ts
    ├─ features/voice/tts-player.ts      features/voice/barge-in.ts
    ├─ components/InterviewerAvatar.tsx  components/TranscriptList.tsx
    ├─ components/LiveCaption.tsx        components/PhaseBadge.tsx
    ├─ store/interviewStore.ts
    └─ export/exporters.ts
```

---

### Task 1: workspace 骨架与共享常量

**Files:**
- Create: `ai-interviewer/package.json`、`pnpm-workspace.yaml`、`.nvmrc`、`.gitignore`
- Create: `packages/shared/package.json`、`tsconfig.json`、`vitest.config.ts`
- Create: `packages/shared/src/types.ts`、`src/limits.ts`、`src/index.ts`
- Test: `packages/shared/src/limits.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `InterviewPhase`、`Atmosphere`、`Track`、`DurationMin`、`DimensionKey`、`Round`、`SessionSnapshot`、`InterviewReport`（Task 5 起全部依赖）；`PHASE_ORDER`、`phasePlan(duration)`、`decideFallback(input)`、`advanceTarget(...)`、各阈值常量。

- [ ] **Step 1: 建 workspace 骨架**

根 `package.json`：`private: true`，`packageManager: "pnpm@8.7.1"`，scripts：
```json
{
  "dev": "pnpm -r --parallel dev",
  "test": "pnpm -r test",
  "typecheck": "pnpm -r typecheck",
  "build": "pnpm -r build"
}
```
`pnpm-workspace.yaml`：`packages: ["packages/*", "apps/*"]`。`.gitignore` 至少包含 `node_modules`、`dist`、`.env`、`*.log`。shared 的 `package.json` 声明 `type: module`、`main: dist/index.js`、`types: dist/index.d.ts`，依赖 `zod@4.6.7`、`ai@7.0.162`（仅类型），devDeps `typescript@5.9.3`、`vitest@5.1.0`。

- [ ] **Step 2: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { decideFallback, phasePlan, PHASE_ORDER } from './limits';

describe('phasePlan', () => {
  it('15 分钟压缩后期阶段', () => {
    const p = phasePlan(15);
    expect(p.intro).toEqual({ min: 1, max: 2 });
    expect(p.project).toEqual({ min: 3, max: 4 });
    expect(p.scenario).toEqual({ min: 2, max: 2 });
    expect(PHASE_ORDER).toEqual(['intro', 'project', 'fundamentals', 'scenario', 'reverse']);
  });
  it('40 分钟加长项目深挖', () => {
    expect(phasePlan(40).project).toEqual({ min: 4, max: 5 });
  });
});

describe('decideFallback', () => {
  const base = { phase: 'project' as const, durationMin: 25 as const };

  it('阶段题量没到下限时继续在同阶段出新题', () => {
    expect(decideFallback({ ...base, askedInPhase: 1, followUps: 0, atmosphere: 'standard' }))
      .toEqual({ move: 'advance', phase: 'project', asked: 2 });
  });

  it('已到下限且追问额度未用完时追问', () => {
    expect(decideFallback({ ...base, askedInPhase: 3, followUps: 0, atmosphere: 'standard' }))
      .toEqual({ move: 'follow_up', phase: 'project', asked: 3 });
  });

  it('压力面追问额度用满即推进', () => {
    expect(decideFallback({ ...base, askedInPhase: 3, followUps: 3, atmosphere: 'pressure' }))
      .toEqual({ move: 'advance', phase: 'project', asked: 4 });
  });

  it('超过本阶段上限时进入下一阶段', () => {
    expect(decideFallback({ ...base, askedInPhase: 5, followUps: 1, atmosphere: 'standard' }))
      .toEqual({ move: 'advance', phase: 'fundamentals', asked: 1 });
  });

  it('reverse 之后进入 done', () => {
    expect(decideFallback({ phase: 'reverse', durationMin: 25, askedInPhase: 1, followUps: 1, atmosphere: 'gentle' }))
      .toEqual({ move: 'close', phase: 'done', asked: 1 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `export PATH="/c/Users/v-renhan/AppData/Local/nvm/v20.19.5:$PATH" && cd /d/20260916/ai-interviewer && pnpm --filter @ai-interviewer/shared test`
Expected: FAIL — `limits.ts` 不存在。

- [ ] **Step 4: 实现 `limits.ts` 与 `types.ts`**

`limits.ts` 导出上表全部常量，并实现：
```ts
export const PHASE_ORDER: Exclude<InterviewPhase, 'done'>[] = ['intro', 'project', 'fundamentals', 'scenario', 'reverse'];

export function phasePlan(d: DurationMin): Record<Exclude<InterviewPhase, 'done'>, { min: number; max: number }>;

export function decideFallback(input: {
  phase: Exclude<InterviewPhase, 'done'>;
  durationMin: DurationMin;
  askedInPhase: number;
  followUps: number;
  atmosphere: Atmosphere;
}): DirectorCtrl;
```
`decideFallback` 规则按顺序：
1. `askedInPhase >= plan[phase].max || followUps >= FOLLOW_UP_LIMIT[atmosphere]` → `advance`；
2. `askedInPhase < plan[phase].min` → `advance`；
3. 否则 → `follow_up`。

`advance` 时目标阶段 = `askedInPhase >= plan[phase].max ? nextPhase(phase) : phase`；进入新阶段时 `asked = 1`，否则 `asked = askedInPhase + 1`。`follow_up` 时 `asked = askedInPhase`（追问计入阶段题量，由调用方另行累加）。`reverse` 上界之后目标为 `done`，`move = 'close'`。

`types.ts` 定义 `SessionSnapshot`（`id/track/atmosphere/durationMin/phase/askedTotal/askedInPhase/followUps/startedAt/status/rounds/report?/resumeText?`）、`Round`（`index/question/displayText?/answer/source/submittedAt/interrupted`）、`DirectorCtrl`（`move: 'follow_up'|'advance'|'close'；phase；asked`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @ai-interviewer/shared test`
Expected: 全部 PASS。

- [ ] **Step 6: 检查点**

Run: `pnpm --filter @ai-interviewer/shared typecheck && pnpm --filter @ai-interviewer/shared test`

---

### Task 2: 预置题包与选题

**Files:**
- Create: `packages/shared/src/question-bank.ts`
- Test: `packages/shared/src/question-bank.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `QuestionItem` 需先补进 `types.ts`：`{ id: string; dimension: DimensionKey; phase: InterviewPhase; displayText: string; speechText: string }`
- Produces: `QUESTION_BANK: QuestionItem[]`、`pickQuestion(phase: InterviewPhase, usedIds: string[]): QuestionItem | null`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { QUESTION_BANK, pickQuestion } from './question-bank';
import { PHASE_ORDER } from './limits';

describe('QUESTION_BANK', () => {
  it('每个能力维度至少 2 道题', () => {
    const dims = ['technical', 'decomposition', 'tradeoff', 'verification', 'communication'] as const;
    for (const d of dims) {
      expect(QUESTION_BANK.filter((q) => q.dimension === d).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('覆盖五个阶段，且 scenario 题一定带 displayText 代码/需求', () => {
    for (const p of PHASE_ORDER) expect(QUESTION_BANK.some((q) => q.phase === p)).toBe(true);
    const scenario = QUESTION_BANK.filter((q) => q.phase === 'scenario');
    expect(scenario.every((q) => q.displayText.includes('```') || q.displayText.length > 40)).toBe(true);
  });
  it('speechText 不含代码围栏', () => {
    expect(QUESTION_BANK.every((q) => !q.speechText.includes('```'))).toBe(true);
  });
});

describe('pickQuestion', () => {
  it('跳过已用过的题', () => {
    const all = QUESTION_BANK.filter((q) => q.phase === 'intro');
    const got = pickQuestion('intro', [all[0].id]);
    expect(got?.id).not.toBe(all[0].id);
  });
  it('题用完后返回 null', () => {
    expect(pickQuestion('reverse', QUESTION_BANK.filter((q) => q.phase === 'reverse').map((q) => q.id))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ai-interviewer/shared test`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写题库**

按设计稿 5.1 的 8 个主题组织，落到 5 个 `DimensionKey` 上，每个维度 ≥2 道，总计 ≥16 道；`reverse` 至少 3 道（给候选人反问）。三道样板（其余按同结构补足，主题：需求拆解、上下文设计、工具编排、RAG、验证调试、工程化、前端迁移、口述 vibe coding）：

```ts
{ id: 'rev-code-review-1', dimension: 'verification', phase: 'scenario',
  displayText: '```ts\nasync function ask(prompt: string) {\n  const r = await fetch(URL, { method: "POST", body: JSON.stringify({ prompt }) });\n  return r.json();\n}\n```\n候选人需要指出：没有超时、没有重试、失败静默、没有校验返回结构。',
  speechText: '屏幕上这段调用 AI 的代码是实习生写的，你先看一眼，说说上线前你会先改哪一处，为什么。' },
{ id: 'proj-rag-1', dimension: 'technical', phase: 'project',
  displayText: '', speechText: '你说做过知识库，那用户问一个文档里没有的问题时，你的系统应该怎么表现？' },
{ id: 'reverse-1', dimension: 'communication', phase: 'reverse',
  displayText: '', speechText: '最后你有什么想问我的？关于团队怎么用 Agent、或者这个岗位的日常工作都行。' }
```

- [ ] **Step 4: 实现 `pickQuestion`**：按 `phase` 过滤、排除 `usedIds`、取第一个；空则 `null`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @ai-interviewer/shared test` → 全部 PASS。

---

### Task 3: 服务端启动、环境变量与密钥注入

**Files:**
- Create: `apps/server/package.json`、`tsconfig.json`、`nest-cli.json`、`.env.example`
- Create: `apps/server/src/main.ts`、`src/app.module.ts`
- Create: `apps/server/src/config/env.ts`、`src/config/config.module.ts`
- Create: `apps/server/src/common/logger.ts`
- Create: `scripts/setup-env.mjs`
- Test: `apps/server/src/config/env.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `AppEnv`、`parseEnv(src)`、`readinessReport(env): string`、`RedactedLogger`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv, readinessReport } from './env';

const full = {
  LLM_API_KEY: 'sk-test-1234567890', LLM_BASE_URL: 'https://x/v1', LLM_MODEL: 'qwen-plus',
  TENCENT_SECRET_ID: 'AKIDxxxx', TENCENT_SECRET_KEY: 'yyyy', TENCENT_APP_ID: '1312591814',
  TENCENT_ASR_ENGINE: '16k_zh', ASR_CORRECTION_MODEL: 'qwen3-asr-flash',
  TTS_PROVIDER: 'edge', EDGE_TTS_VOICE: 'zh-CN-XiaoxiaoNeural',
  TTS_FALLBACK_PROVIDER: 'dashscope', DASHSCOPE_TTS_VOICE: 'longxiaochun_v2',
  SPEECH_MODE: 'mock', PORT: '3001',
};

describe('parseEnv', () => {
  it('完整配置时 missing 为空', () => {
    expect(parseEnv(full).missing).toEqual([]);
  });
  it('缺键只报键名，不报值', () => {
    const r = parseEnv({ ...full, TENCENT_SECRET_KEY: '' });
    expect(r.missing).toEqual(['TENCENT_SECRET_KEY']);
    expect(JSON.stringify(r)).not.toContain('AKIDxxxx');
  });
  it('SPEECH_MODE 非法时回落到 mock', () => {
    expect(parseEnv({ ...full, SPEECH_MODE: 'weird' }).env.speechMode).toBe('mock');
  });
});

describe('readinessReport', () => {
  it('只输出已配置/缺失，不含任何密钥值', () => {
    const text = readinessReport(parseEnv(full).env);
    expect(text).toContain('LLM: 已配置');
    expect(text).toContain('腾讯 ASR: 已配置');
    expect(text).not.toContain('sk-test');
    expect(text).not.toContain('AKID');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ai-interviewer/server test`
Expected: FAIL — `env.ts` 不存在（Nest 包先装好：`@nestjs/core@12.3.2 @nestjs/common@12.3.2 @nestjs/platform-express@12.3.2 reflect-metadata rxjs ws zod ai @ai-sdk/openai-compatible msedge-tts wavefile`，devDeps `@nestjs/cli@12.0.11 typescript vitest @types/node @types/ws tsx`）。

- [ ] **Step 3: 实现 `env.ts`**

`parseEnv(src: NodeJS.ProcessEnv): { env: AppEnv; missing: string[] }`；`AppEnv` 字段全部 camelCase（`llmApiKey`、`tencentSecretKey`、`speechMode` 等），`missing` 只列键名。`readinessReport` 返回多行：`LLM: 已配置|缺失`、`腾讯 ASR: …`、`TTS(edge): 恒定已配置`、`语音模式: mock|live`。**不得**读取或输出额度。

- [ ] **Step 4: 实现 `setup-env.mjs`**

用 Node 标准库：解析 `C:\Users\v-renhan\Downloads\SecretKey.csv`（表头 `SecretId,SecretKey`，去 BOM）与 `D:/20260916/knowledge-hub-backend/.env`（取 `OPENAI_API_KEY`），生成 `apps/server/.env`。若目标已存在则只补齐缺失键、不覆盖已有值。末尾只打印 `写入完成：N 个键（LLM_API_KEY, TENCENT_SECRET_ID, …）`，**任何分支都不打印值**。文件权限失败时打印路径建议，不打印内容。

- [ ] **Step 5: 跑测试与脚本**

Run: `node scripts/setup-env.mjs` → 打印键名清单，不含值。
Run: `pnpm --filter @ai-interviewer/server test` → PASS。

- [ ] **Step 6: 实现 `main.ts` / `AppModule` 与脱敏日志**

启动时 `readinessReport` 打印一次；`RedactedLogger` 提供 `log(event, fields)`，对 `secret|key|token|password|authorization` 命中的字段统一替换为 `***`，并提供 `assertNoSecret(line)` 在含 32 位以上疑似密钥时抛错（防止误打印）。

- [ ] **Step 7: 检查点**：`pnpm --filter @ai-interviewer/server typecheck && pnpm --filter @ai-interviewer/server test`

---

### Task 4: `<<CTRL>>` 流式控制行解析

**Files:**
- Create: `apps/server/src/llm/director-parser.ts`
- Test: `apps/server/src/llm/director-parser.spec.ts`

**Interfaces:**
- Consumes: Task 1 `DirectorCtrl`
- Produces: `DirectorStreamParser`（`push(chunk): { ctrl?: DirectorCtrl; text: string }`、`flush(): string`、`get violated(): boolean`）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { DirectorStreamParser } from './director-parser';

const line = '<<CTRL {"move":"follow_up","phase":"project","asked":3}>>\n\n';

describe('DirectorStreamParser', () => {
  it('整块输入时剥离控制行', () => {
    const p = new DirectorStreamParser();
    expect(p.push(line + '先说你测过哪些边界。')).toEqual({
      ctrl: { move: 'follow_up', phase: 'project', asked: 3 }, text: '先说你测过哪些边界。',
    });
  });

  it('控制行被拆在多个 chunk 里也不外泄', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {"move":"adv')).toEqual({ text: '' });
    expect(p.push('ance","phase":"project","asked":4}>>\n')).toEqual({ text: '' });
    expect(p.push('\n好的。')).toEqual({
      ctrl: { move: 'advance', phase: 'project', asked: 4 }, text: '好的。',
    });
  });

  it('没有控制行时原样透传并标记违规', () => {
    const p = new DirectorStreamParser();
    expect(p.push('直接开始问：')).toEqual({ text: '直接开始问：' });
    expect(p.violated).toBe(true);
  });

  it('控制行 JSON 坏掉时丢弃该行，正文照常', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {oops}>>\n正文')).toEqual({ text: '正文' });
    expect(p.violated).toBe(true);
    expect(p.push('继续').text).toBe('继续');
  });

  it('CRLF 换行同样识别', () => {
    const p = new DirectorStreamParser();
    expect(p.push(line.replace(/\n/g, '\r\n') + '末')).toEqual({
      ctrl: { move: 'follow_up', phase: 'project', asked: 3 }, text: '末',
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `pnpm --filter @ai-interviewer/server test` FAIL（模块不存在）。

- [ ] **Step 3: 实现**

算法（签名与测试确定不了的部分）：维护 `headBuffer` 与前导空白跳过标记。未决策前把所有到达的数据追加进 `headBuffer`；若去掉前导空白后不是 `<<CTRL ` 开头，立刻把 `headBuffer` 作为 `text` 一次性吐出并置 `violated`，此后进入直通模式。若是，等待出现首个换行：解析 `<<CTRL ` 到最后 `>>` 之间的 JSON（用 `JSON.parse`，失败则置 `violated`、`ctrl` 为 `null`），丢弃控制行与紧随的一个空行，返回其余部分；之后所有 `push` 直通。`flush()` 返回剩余缓冲。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 5: system prompt 组装与三档氛围

**Files:**
- Create: `apps/server/src/llm/prompts.ts`
- Test: `apps/server/src/llm/prompts.spec.ts`

**Interfaces:**
- Consumes: Task 1 `SessionSnapshot`、`phasePlan`、`FOLLOW_UP_LIMIT`；Task 2 `QuestionItem`
- Produces: `buildSystemPrompt(input: { snapshot: SessionSnapshot; question?: QuestionItem; resumeText?: string }): string`、`speechOnly(text: string): string`

- [ ] **Step 1: 写失败测试**

```ts
import { buildSystemPrompt, speechOnly } from './prompts';
import type { SessionSnapshot } from '@ai-interviewer/shared';

const snap = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 's1', track: 'frontend-to-agent', atmosphere: 'standard', durationMin: 25,
  phase: 'project', askedTotal: 3, askedInPhase: 2, followUps: 1, startedAt: 0,
  status: 'active', rounds: [], ...over,
});

describe('buildSystemPrompt', () => {
  it('包含阶段、题量、氛围与口播约束', () => {
    const p = buildSystemPrompt({ snapshot: snap() });
    expect(p).toContain('project');
    expect(p).toContain('2–4 句');
    expect(p).toContain('<<CTRL ');
    expect(p).toContain('2 层');
  });
  it('压力面强调 60 秒与量化', () => {
    const p = buildSystemPrompt({ snapshot: snap({ atmosphere: 'pressure' }) });
    expect(p).toContain('60 秒');
    expect(p).toContain('必须给数字');
  });
  it('温和引导不打断且给提示', () => {
    const p = buildSystemPrompt({ snapshot: snap({ atmosphere: 'gentle' }) });
    expect(p).toContain('给提示');
    expect(p).not.toContain('直接质疑');
  });
  it('评审题的代码只进 displayText 提示，不进口播要求', () => {
    const p = buildSystemPrompt({
      snapshot: snap({ phase: 'scenario' }),
      question: { id: 'q', dimension: 'verification', phase: 'scenario',
        displayText: '```ts\nconst x = 1;\n```', speechText: '看看这段代码。' },
    });
    expect(p).toContain('不要朗读代码');
    expect(p).toContain('看看这段代码。');
  });
});

describe('speechOnly', () => {
  it('剥掉围栏代码块', () => {
    expect(speechOnly('先看：\n```ts\nconst a=1\n```\n再说。').trim()).toBe('先看：\n\n再说。'.trim());
  });
  it('剥掉行内代码反引号', () => {
    expect(speechOnly('用 `useChat` 收流')).toBe('用 useChat 收流');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`buildSystemPrompt` 拼接：人设（一线 Agent 团队技术负责人）→ 岗位方向说明 → 当前阶段目标与 `min/max`、已问数、剩余数 → 氛围矩阵（追问层数上限、答不上来的处理、打断阈值、是否要求量化、冷场秒数）→ 口播硬约束（2–4 句、先给结论、不讲课、一次一个问题、不要朗读代码）→ 输出格式要求（首行 `<<CTRL {"move":"follow_up|advance|close","phase":"…","asked":N}>>`，空行，再正文）→ 最近的轮次摘要 → 简历文本（若有）。

`speechOnly`：先删 ``` 围栏块（含围栏行），再把剩余的反引号去掉，折叠 3 个以上连续换行。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 6: LLM provider、单轮流式与 SSE 端点

**Files:**
- Create: `apps/server/src/llm/llm.service.ts`、`llm/llm.module.ts`
- Create: `apps/server/src/interview/interview.service.ts`、`session.store.ts`、`testing.ts`
- Create: `apps/server/src/interview/turn.service.ts`
- Create: `apps/server/src/interview/interview.controller.ts`
- Test: `apps/server/src/interview/turn.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `decideFallback`；Task 4 `DirectorStreamParser`；Task 5 `buildSystemPrompt`；Task 3 `AppEnv`
- Produces: `createTurnStream(deps, { sessionId, text }): ReadableStream<UIMessageChunk>`；`InterviewService`（`create(dto)`、`get(id)`、`appendAnswer(id, input)`、`applyDirector(id, ctrl)`、`interrupt(id)`、`finish(id)`）；`SessionStore`；测试辅助 `makeService()`、`snapshotWith(rounds)`、`scriptedModel(text)`。

- [ ] **Step 1: 写失败测试**（用 `ai/test` 的 `MockLanguageModelV4`）

```ts
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { createTurnStream } from './turn.service';
import { makeService } from './testing';

// 把一段模型输出切成 4 个 delta 推给 mock
function modelSaying(text: string) {
  const step = Math.ceil(text.length / 4);
  const deltas = Array.from({ length: 4 }, (_, i) => text.slice(i * step, (i + 1) * step)).filter(Boolean);
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'text-start', id: 't' },
        ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
        { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ]),
    }),
  });
}
```

测试断言（逐条实现，勿弱化）：
1. 首两个 data part 依次是 `data-phase`、`data-director`，且都出现在第一个 `text-delta` 之前。
2. 拼接所有 `text-delta` 得到的文本**不含** `<<CTRL`。
3. 模型不输出控制行时，`data-director` 等于 `decideFallback` 的结果，且 session 上 `formatViolations` 加一。
4. 流结束后 session `rounds` 只追加 1 条，内容为模型正文。
5. 中途 `interrupt(sessionId)` 后，已产出的文本仍被记入 `rounds[0].answer`，`interrupted === true`，且流不再产出新的 `text-delta`。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `turn.service.ts`**

```ts
export interface TurnDeps {
  model: LanguageModel;
  interviews: InterviewService;
  tts: { speak(sessionId: string, turnId: string, text: string): void; finishTurn(sessionId: string, turnId: string): void; abortTurn(sessionId: string, turnId: string): void };
  now?: () => number;
}
export function createTurnStream(deps: TurnDeps, input: { sessionId: string; text: string }): ReadableStream<UIMessageChunk>;
```
流程：取 snapshot → `appendAnswer`（此时先不落 answer，待流结束再写）→ 记录 AbortController → `streamText({ model, system: buildSystemPrompt(...), prompt: userAnswer })` → 消费 `result.textStream` 经 `DirectorStreamParser`：
- 解析出 `ctrl` 后先 `writer.write({ type: 'data-director', data: ctrl })`；若为 `null` 用 `decideFallback` 兜底并 `interviews.noteFormatViolation(id)`；
- 再 `writer.write({ type: 'data-phase', data: { phase: ctrl.phase, askedInPhase: ctrl.asked } })`；
- 正文按 `text-start` / `text-delta` / `text-end` 写（固定 `id = turnId`），同时 `tts.speak(...)` 按句喂；
- 结束时 `writer.write({ type: 'data-tts', data: { turnId, state: 'done' } })`、`interviews.appendAnswer(...)`、`applyDirector(id, ctrl)`。

`MockLanguageModelV4` 的 `doStream` 返回 `{ stream: ReadableStream<LanguageModelV4StreamPart> }`；`convertArrayToReadableStream` 来自 `ai/test`。断言里用 `convertReadableStreamToArray(stream)` 收集 `UIMessageChunk` 序列。

- [ ] **Step 4: 实现 `llm.service.ts`**

```ts
const provider = createOpenAICompatible({ name: 'dashscope', baseURL: env.llmBaseUrl, apiKey: env.llmApiKey });
model = provider(env.llmModel);
```

- [ ] **Step 5: 实现 controller**

`POST /api/interview` 建会话；`POST /api/interview/:id/turn`（body `{ text: string }`）用 `@Res()` + `pipeUIMessageStreamToResponse({ response: res, stream })`；`POST /api/interview/:id/interrupt`；`POST /api/interview/:id/nudge`；`POST /api/interview/:id/finish`（Task 8）；`GET /api/interview/:id`（404 表示会话已丢失）。

- [ ] **Step 6: 跑测试确认通过** → PASS。

---

### Task 7: 会话存储、轮次记录与打断标记

**Files:**
- Create: `apps/server/src/interview/session.store.ts`
- Modify: `apps/server/src/interview/interview.service.ts`
- Test: `apps/server/src/interview/interview.service.spec.ts`

**Interfaces:**
- Produces: `SessionStore`（`set/get/delete/clear`）、`InterviewService` 完整方法、`noteFormatViolation(id)`、`snapshot(id)`。

- [ ] **Step 1: 写失败测试**

```ts
it('结束后状态为 finished 且不能再次 append', () => {
  const svc = makeService();
  const s = svc.create({ track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 });
  svc.markFinished(s.id);
  expect(() => svc.appendAnswer(s.id, { question: 'q', answer: 'a', source: 'text' })).toThrow();
});
it('打断时把半句话写回并标记 interrupted', () => {
  const svc = makeService();
  const s = svc.create({ track: 'agent-engineer', atmosphere: 'pressure', durationMin: 15 });
  svc.beginTurn(s.id, '第 1 个问题');
  svc.appendPartial(s.id, '我说到这里就被打断了');
  svc.interrupt(s.id);
  const r = svc.get(s.id).rounds[0];
  expect(r.answer).toBe('我说到这里就被打断了');
  expect(r.interrupted).toBe(true);
});
it('interrupt 幂等，不会重复追加轮次', () => { /* 连续两次 interrupt，rounds 长度仍为 1 */ });
it('会话不存在时 get 抛 NotFoundException', () => { /* ... */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**：`SessionStore` 用 `Map<string, SessionState>`；`SessionState` 在 `SessionSnapshot` 基础上含 `pendingTurn?: { question: string; partial: string; controller: AbortController }`、`formatViolations: number`。`appendAnswer` 在 `status === 'finished'` 时抛 `BadRequestException`。`interrupt` 若存在 `pendingTurn` 则写入 `rounds`（`interrupted: true`）并清空；重复调用无副作用。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 8: 评价报告（generateObject + 降级）

**Files:**
- Create: `packages/shared/src/report-schema.ts`
- Create: `apps/server/src/report/report.service.ts`
- Test: `apps/server/src/report/report.service.spec.ts`

**Interfaces:**
- Produces: `ReportSchema`、`InterviewReport`、`ReportService.generate(snapshot): Promise<InterviewReport>`、`ReportService.fallback(snapshot): InterviewReport`。

- [ ] **Step 1: 写失败测试**

```ts
it('维度必须恰好 5 个且 key 合法', () => {
  expect(() => ReportSchema.parse({ total: 70, dimensions: [], strengths: [], gaps: [], actions: [] })).toThrow();
});
it('正常路径返回结构化报告', async () => {
  const svc = new ReportService(mockModelReturning(validReport));
  const r = await svc.generate(snapshotWith3Rounds);
  expect(r.total).toBe(72);
  expect(r.dimensions).toHaveLength(5);
});
it('模型失败时降级报告仍含 5 维与 3 条建议', async () => {
  const svc = new ReportService(throwingModel);
  const r = await svc.generate(snapshotWith3Rounds);
  expect(r.dimensions).toHaveLength(5);
  expect(r.actions).toHaveLength(3);
  expect(r.fallback).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 schema**

`ReportSchema` 按设计稿 6.6；`dimensions` 用 `z.array(...).length(5)` 并要求 `key` 为 `DimensionKey` 五值之一；`strengths`/`gaps` `.min(3).max(5)`；`actions` `.length(3)`。`InterviewReport = z.infer<typeof ReportSchema> & { fallback?: boolean }`。

- [ ] **Step 4: 实现 `ReportService`**

`generate`：`generateObject({ model, schema: ReportSchema, system: 评分员提示, prompt: 完整 transcript JSON })`，失败重试一次，再失败 `fallback`。`fallback`：`total = 60`，五维各 6 分并给固定评语，`strengths/gaps` 从最近 3 轮各取一条（引用原话前 40 字），`actions` 用三条固定但针对性的建议，`fallback: true`。

- [ ] **Step 5: 跑测试确认通过** → PASS。

---

### Task 9: 导出 Markdown / JSON

**Files:**
- Create: `apps/server/src/export/export.service.ts`、`export/export.controller.ts`
- Create: `apps/web/src/export/exporters.ts`
- Test: `apps/server/src/export/export.service.spec.ts`

**Interfaces:**
- Produces: `toMarkdown(snapshot): string`、`toJson(snapshot): string`、`exportFileName(snapshot): { md: string; json: string }`；REST `GET /api/interview/:id/export?format=md|json`。

- [ ] **Step 1: 写失败测试**

```ts
it('每条轮次的问题与回答都出现', () => {
  const md = toMarkdown(snapshotWith2Rounds);
  expect(md).toContain('第 1 轮');
  expect(md).toContain('RAG 的召回怎么做');
});
it('被打断的轮次有标记', () => {
  expect(toMarkdown(snapshotWithInterrupted)).toContain('（被打断）');
});
it('没有报告时导出不抛错，写明报告未生成', () => {
  const md = toMarkdown(snapshotWithoutReport);
  expect(md).toContain('评价报告尚未生成');
});
it('文件名含方向 slug 与日期', () => {
  expect(exportFileName(snapshotOn('2026-11-04'))).toEqual({
    md: 'interview-2026-11-04-frontend-to-agent.md',
    json: 'interview-2026-11-04-frontend-to-agent.json',
  });
});
it('导出的 JSON 可被 JSON.parse 且含 rounds 与 report', () => {
  const o = JSON.parse(toJson(snapshotWithReport));
  expect(o.rounds).toHaveLength(2);
  expect(o.report.total).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**：Markdown 结构按设计稿 4.3 顺序（元信息 → 完整 transcript → 报告 → 逐题回看）；transcript 行格式 `[HH:mm] 候选中（语音/文字）：…`，被打断追加 `（被打断）`。`exportFileName` 用本地日期 `YYYY-MM-DD` 与 track slug（`agent-engineer` / `frontend-to-agent` / `backend-ai`）。

- [ ] **Step 4: 实现 controller**：`@Res()` 设 `Content-Type: text/markdown; charset=utf-8` 或 `application/json`，`Content-Disposition: attachment; filename="<name>"`；报告在生成中（`status === 'finished'` 但 `report` 为空）时返回 `202` 与 `{ pending: true }`，前端提示「报告生成中」。

- [ ] **Step 5: 跑测试确认通过** → PASS。

---

### Task 10: 腾讯实时 ASR 适配器（唯一手写协议）

**Files:**
- Create: `apps/server/src/asr/tencent-asr.client.ts`
- Test: `apps/server/src/asr/tencent-asr.client.spec.ts`

**Interfaces:**
- Produces: `buildAsrUrl(opts): string`、`class TencentAsrSession`（`push(pcm: Buffer): void`、`end(): Promise<string>`、`close(): void`、构造参数含 `wsFactory` 便于测试）。

- [ ] **Step 1: 写失败测试**

```ts
it('相同入参生成完全相同的签名 URL', () => {
  const a = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42 });
  const b = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42 });
  expect(a).toBe(b);
});
it('参数按字母序拼接，voice_id 变化则签名变化', () => {
  const a = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42, voiceId: 'v1' });
  const b = buildAsrUrl({ ...fixed, now: 1762300000, nonce: 42, voiceId: 'v2' });
  expect(a).not.toBe(b);
  expect(a).toContain('engine_model_type=16k_zh');
});
it('push 按 40ms 帧切分（16k*0.04*2 = 1280 字节）', async () => {
  const frames: number[] = [];
  const s = new TencentAsrSession({ ...fixed, onMessage: () => {}, wsFactory: fakeWs((p) => frames.push(p.length)) });
  s.push(Buffer.alloc(3000));
  expect(frames).toEqual([1280, 1280, 440]);
});
it('slice_type 为 2 时 end() 返回最终文本', async () => { /* fake ws 推送两条消息，断言 resolve 文本 */ });
it('腾讯返回错误码时 end() resolve 空串而不是 reject', async () => { /* code: 4004 */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

签名（与课程代码一致，勿改参数名大小写）：
```ts
const params = { secretid, timestamp, expired: now + 86400, nonce, engine_model_type: '16k_zh',
  voice_format: 1, voice_id: voiceId, needvad: 1, filter_dirty: 0, filter_modal: 0,
  filter_punc: 0, convert_num_mode: 1, word_info: 0 };
const signStr = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
const signature = createHmac('sha1', secretKey).update(`asr.cloud.tencent.com/asr/v2/${appId}?${signStr}`).digest('base64');
```
帧大小 `640` 采样（1280 字节），末尾不足一帧原样发送。消息 `{ result: { slice_type: 0|1 → 回调; 2 → 完结 } }`；`code !== 0` 时置 `errorCode` 并 resolve 空串（调用方据此降级）。

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: 手动联通一次（仅 live）**

写 `scripts/smoke-asr.mjs`：读 `apps/server/.env`，用 `wavefile` 或课程参考音频生成 1 秒 PCM 送入，打印识别文本与耗时。**不得**打印凭据。若额度耗尽，记录错误码到 README 的「已知限制」，保留按句降级路径。

---

### Task 11: ASR WebSocket 网关与 mock 模式

**Files:**
- Create: `apps/server/src/asr/asr.gateway.ts`
- Create: `packages/shared/src/wire.ts`
- Test: `apps/server/src/asr/asr.gateway.spec.ts`

**Interfaces:**
- Consumes: Task 10 `TencentAsrSession`；Task 12 `CorrectionService`（下一步）
- Produces: `AsrGateway` 处理 `/ws/asr?session=<id>`；`AsrClientMessage` / `AsrServerMessage` 类型；`createMockAsr()`。

- [ ] **Step 1: 写失败测试**

```ts
it('utterance_start + 音频 + utterance_end 后推送 asr_final', async () => { /* fake 上游返回 '你好' */ });
it('实时 partial 转成 asr_partial 且不覆盖终稿', async () => { /* 顺序：partial, partial, final */ });
it('腾讯不可用时推送 asr_error 且不抛出', async () => { /* 上游 code 4004 */ });
it('mock 模式下按预置脚本输出，且不创建上游连接', async () => {
  const created: string[] = [];
  const gw = makeGateway({ speechMode: 'mock', onUpstream: (u: string) => created.push(u) });
  await gw.handle(client, { type: 'utterance_start', voiceId: 'v1' });
  expect(created).toHaveLength(0);
});
it('同一 voiceId 重复 utterance_start 幂等', async () => { /* ... */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**：`wire.ts` 定义两侧消息类型（partial / final / normalized / error；start / end / cancel）。网关按连接维护 `voiceId → { session, pcmChunks }`；`utterance_end` 后：关闭上游 → 用累积 PCM 调 `CorrectionService.transcribe`（失败则用上游文本）→ 推 `asr_final` → 并行调 `TermNormalizer.normalize` → 有变化推 `asr_normalized`。`SPEECH_MODE=mock` 时用固定脚本：partial 逐字增长到「我做过一个基于 React 和 NestJS 的知识库项目」，final 同文。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 12: 终稿校正与术语归一

**Files:**
- Create: `apps/server/src/asr/correction.service.ts`、`asr/normalizer.service.ts`
- Test: `apps/server/src/asr/correction.service.spec.ts`、`normalizer.service.spec.ts`

**Interfaces:**
- Produces: `pcm16ToWav(pcm: Buffer, sampleRate?: number): Buffer`、`CorrectionService.transcribe(pcm: Buffer): Promise<string | null>`、`TermNormalizer.normalize(text: string): Promise<string>`、`GLOSSARY: string[]`。

- [ ] **Step 1: 写失败测试**

```ts
it('wav 头长度与关键字段正确', () => {
  const wav = pcm16ToWav(Buffer.alloc(3200));
  expect(wav.length).toBe(44 + 3200);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wav.readUInt32LE(4)).toBe(36 + 3200);
  expect(wav.readUInt32LE(24)).toBe(16000);
});
it('识别失败返回 null，不抛错', async () => { /* fetch 返回 400 */ });
it('载荷是 data:audio/wav;base64，且不含 API Key 明文以外的任何日志', async () => { /* 断言 body.model === 'qwen3-asr-flash' */ });
it('归一超时 800ms 后返回原文', async () => {
  const n = new TermNormalizer({ model: neverResolvingModel, timeoutMs: 50 });
  const t0 = Date.now();
  expect(await n.normalize('用 给西斯诺特 写接口')).toBe('用 给西斯诺特 写接口');
  expect(Date.now() - t0).toBeLessThan(500);
});
it('谐音词被纠正', async () => {
  expect(await new TermNormalizer({ model: fixedModel('用 NestJS 写接口') }).normalize('用 给西斯诺特 写接口')).toBe('用 NestJS 写接口');
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**：`CorrectionService` 调 `POST {llmBaseUrl 去掉 /compatible-mode/v1 后接 /api/v1/services/aigc/multimodal-generation/generation}` 不方便，直接写常量 `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，body `{ model: env.asrCorrectionModel, input: { messages: [{ role: 'user', content: [{ audio: 'data:audio/wav;base64,…' }] }] }, parameters: { asr_options: { language: 'zh' } } }`。超时 5s，非 200 或空文本返回 `null`。

`TermNormalizer` 用 `generateText` + 8 条术语表，`AbortSignal.timeout(timeoutMs)`；错误/空结果返回原文；仅在文本含英文术语谐音可疑时调用（`/[\u4e00-\u9fa5]{2,}(诺特|拉客|艾特)/` 之类简单的预筛可省调用）。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 13: 断句、TTS 服务与备用 provider

**Files:**
- Create: `apps/server/src/tts/sentence-splitter.ts`、`tts/tts.service.ts`、`tts/dashscope-tts.ts`
- Test: `apps/server/src/tts/sentence-splitter.spec.ts`、`tts/tts.service.spec.ts`

**Interfaces:**
- Produces: `splitSentences(buffer, opts?): { sentences: string[]; rest: string }`、`TtsService.speak(sessionId, turnId, text)`、`TtsService.finishTurn`、`TtsService.abortTurn`。

- [ ] **Step 1: 写失败测试**

```ts
it('按中文标点切句', () => {
  expect(splitSentences('先讲结论。再说细节！还有吗？').sentences)
    .toEqual(['先讲结论。', '再说细节！', '还有吗？']);
});
it('不完整的尾巴留在 rest', () => {
  expect(splitSentences('先说结论。然后').rest).toBe('然后');
});
it('超过 30 字无标点时强切', () => {
  const long = '一'.repeat(70);
  const r = splitSentences(long);
  expect(r.sentences[0].length).toBe(30);
  expect(r.sentences).toHaveLength(2);
  expect(r.rest.length).toBe(10);
});
it('代码围栏不会进入待朗读文本', () => {
  const r = splitSentences('看这段：\n```ts\nconst a = 1;\n```\n有问题吗？');
  expect(r.sentences.join('')).not.toContain('const a');
});
it('TTS 使用 speechOnly 之后的文本', async () => { /* 断言 msedge-tts 收到的 input 不含反引号 */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`splitSentences`：在 ``` 围栏内部直接丢弃（跨 chunk 时用一个 `inFence` 标记，由调用方持有状态——因此签名改为 `createSentenceSplitter()` 工厂，返回 `push(chunk): string[]` 与 `flush(): string`；测试仍覆盖上述行为）。切分规则：`。！？；\n` 断句；无标点累计超过 30 字则在第 30 字强切；首尾空白丢弃；空句丢弃。

`TtsService` 持有 `Map<sessionId, { turnId; aborted }>`；`speak` 内用 `new MsEdgeTTS()` → `setMetadata(env.edgeTtsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true })` → `toStream(text)`，把 `audioStream` 的 data 事件通过注入的 `emitBinary(sessionId, buf)` 发出，`metadataStream` 的 `WordBoundary` 事件解析出 `{ text, audioOffset }` 走 `emitJson`。失败重试一次，再失败切 `dashscope-tts.ts`（设计稿 6.3 的 WS 协议，参数 `model: cosyvoice-v2`、`voice: longshaochun_v2`、`format: mp3`），两者都失败则 emit `tts_error`。

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: 手动验证首包**

`scripts/smoke-tts.mjs`：合成一句 20 字中文，打印「首包字节数 / 首包毫秒」（实测基线 563ms），不打印任何凭据。

---

### Task 14: `/ws/tts` 网关与打断

**Files:**
- Create: `apps/server/src/tts/tts.gateway.ts`
- Modify: `apps/server/src/interview/turn.service.ts`
- Test: `apps/server/src/tts/tts.gateway.spec.ts`

**Interfaces:**
- Produces: `TtsGateway` 处理 `/ws/tts?session=<id>`；`abortTurn` 关闭会话并推 `{ type: 'tts_abort', turnId }`。

- [ ] **Step 1: 写失败测试**

```ts
it('文本帧发元数据，二进制帧发音频', async () => { /* 断言首个文本帧为 tts_start，随后 binary */ });
it('abort 后不再推送该 turnId 的音频', async () => { /* abort 后 push 一段，断言客户端未收到 */ });
it('没有客户端连接时 speak 不抛错（只丢音频）', async () => { /* ... */ });
it('同一 session 重连后只有新连接收到音频，旧连接不报错', async () => { /* ... */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**：网关维护 `sessionId → Set<WebSocket>`；`{ type:'tts_start', turnId, segId }` 在每个句子前发送；音频以 `binary` 帧发送；`segId` 递增。客户端发 `{ type:'barge_in', turnId }` 时调用 `interviews.interrupt(sessionId)` + `tts.abortTurn`。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 15: Web 骨架、开始页与 API 客户端

**Files:**
- Create: `apps/web/package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`
- Create: `apps/web/src/main.tsx`、`App.tsx`、`api/client.ts`
- Create: `apps/web/src/pages/SetupPage.tsx`
- Create: `apps/web/src/store/interviewStore.ts`
- Test: `apps/web/src/pages/SetupPage.test.tsx`

**Interfaces:**
- Consumes: shared 的 `Track` / `Atmosphere` / `DurationMin`
- Produces: `apiClient`（`createSession`、`interrupt`、`nudge`、`finish`、`getSession`、`exportUrl`）、`SetupPage`、`useInterviewStore`。

- [ ] **Step 1: 写失败测试**

```tsx
it('默认选中「前端转 Agent」「标准」「25 分钟」', () => {
  render(<SetupPage />);
  expect(screen.getByRole('radio', { name: /前端转 Agent/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^标准/ })).toBeChecked();
});
it('三档氛围各自有一句话说明', () => {
  render(<SetupPage />);
  expect(screen.getByText(/追问最多 1 层/)).toBeInTheDocument();
});
it('点击开始调用 createSession 并带上三项选择', async () => {
  const spy = vi.spyOn(apiClient, 'createSession');
  render(<SetupPage />);
  await userEvent.click(screen.getByRole('radio', { name: /压力面/ }));
  await userEvent.click(screen.getByRole('button', { name: /开始面试/ }));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ atmosphere: 'pressure' }));
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL（先装依赖：`react@19.3.1 react-dom@19.3.1 antd@6.7.0 zustand@5.0.16 echarts@6.1.0 ai@7.0.162 @ai-sdk/react@4.0.166 @ricky0123/vad-web@0.0.31 mse-audio-wrapper@1.4.15 file-saver@2.0.5 reconnecting-websocket@4.4.0`；devDeps `vite@8.3.5 @vitejs/plugin-react@6.2.1 vitest@5.1.0 jsdom@30.1.3 @testing-library/react@16.3.3 @testing-library/user-event`）。

- [ ] **Step 3: 实现**

SetupPage：三段单选（方向 / 氛围 / 时长）+ 简历文本框（可选）+ 音色选择（来自固定列表，失败用默认）+ 「开始面试」。选项说明文案必须与设计稿 5.3 一致（温和：追问最多 1 层、答不上来给提示；压力：追问 2–3 层、必须给数字、超 60 秒催结论）。`vite.config.ts` 设 `server.proxy` 把 `/api`、`/ws` 代理到 `http://localhost:3001`（`ws: true`）。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 16: 面试页 —— 流式对话、阶段与丢失提示

**Files:**
- Create: `apps/web/src/features/chat/useInterviewChat.ts`、`features/chat/messageText.ts`
- Create: `apps/web/src/pages/InterviewPage.tsx`
- Create: `apps/web/src/components/TranscriptList.tsx`、`PhaseBadge.tsx`、`InterviewerAvatar.tsx`
- Test: `apps/web/src/features/chat/messageText.test.ts`、`apps/web/src/pages/InterviewPage.test.tsx`

**Interfaces:**
- Produces: `extractLastUserText(messages): string`、`useInterviewChat({ sessionId, onPhase, onDirector })`、`InterviewPage`。

- [ ] **Step 1: 写失败测试**

```ts
it('取最后一条用户消息的文本', () => {
  const msgs: InterviewUIMessage[] = [
    { id: '1', role: 'user', parts: [{ type: 'text', text: '第一句' }] },
    { id: '2', role: 'assistant', parts: [{ type: 'text', text: '回应' }] },
    { id: '3', role: 'user', parts: [{ type: 'text', text: '第二句' }] },
  ];
  expect(extractLastUserText(msgs)).toBe('第二句');
});
it('消息里没有用户文本时返回空串', () => { /* ... */ });
```

```tsx
it('收到 data-phase 后进度条更新', async () => { /* 假 transport 推 data-phase project 3，断言「项目深挖 3」可见 */ });
it('会话 404 时显示「会话已丢失」而不是白屏', async () => { /* mock getSession 抛 404 */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`useInterviewChat`：
```ts
const transport = useMemo(() => new DefaultChatTransport<InterviewUIMessage>({
  api: '/api/interview/turn',
  prepareSendMessagesRequest: ({ messages }) => ({ body: { sessionId, text: extractLastUserText(messages) } }),
}), [sessionId]);
return useChat<InterviewUIMessage>({ id: sessionId, transport, onData: (part) => {
  if (part.type === 'data-phase') setPhase(part.data.phase, part.data.askedInPhase);
  if (part.type === 'data-director') setDirector(part.data);
}});
```
InterviewPage 布局按设计稿 4.2（左：头像 + 对话；右：进度 + 实时字幕 + 输入）。文字模式：输入框提交走 `sendMessage({ text })`。刷新提示：挂载时 `getSession` 404 → 整页替换为「会话已丢失，请重新开始」+ 返回按钮。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 17: 麦克风、VAD、实时字幕与轮次组装

**Files:**
- Create: `apps/web/src/features/voice/pcm.ts`、`useMicVad.ts`、`useAsrSocket.ts`、`turn-assembler.ts`
- Create: `apps/web/src/components/LiveCaption.tsx`
- Modify: `InterviewPage.tsx`
- Test: `apps/web/src/features/voice/turn-assembler.test.ts`、`features/voice/pcm.test.ts`

**Interfaces:**
- Produces: `floatToInt16(frame: Float32Array): Int16Array`、`createTurnAssembler()`、`useMicVad(opts)`、`useAsrSocket(sessionId)`。

- [ ] **Step 1: 写失败测试**

```ts
it('Float32 溢出时夹紧到 int16 范围', () => {
  const out = floatToInt16(new Float32Array([1, -1, 0.5, 2, -2]));
  expect(Array.from(out)).toEqual([32767, -32768, 16384, 32767, -32768]);
});
it('第一段语音开始计时，并累计多段文本', () => {
  const a = createTurnAssembler();
  expect(a.push({ type: 'segment_final', text: '我做过知识库', at: 0 })).toEqual([]);
  a.push({ type: 'segment_final', text: '主要做前端渲染', at: 9000 });
  expect(a.state().text).toBe('我做过知识库 主要做前端渲染');
});
it('静音 2.5 秒触发提交', () => {
  const a = createTurnAssembler();
  a.push({ type: 'segment_final', text: '回答', at: 1000 });
  expect(a.push({ type: 'tick', at: 3000 })).toEqual([]);
  expect(a.push({ type: 'tick', at: 3501 })).toEqual([{ type: 'submit', text: '回答', reason: 'silence' }]);
});
it('90 秒硬上限提交', () => { /* at 0 开始，tick at 90000 → submit reason: 'timeout' */ });
it('空文本不提交', () => {
  const a = createTurnAssembler();
  a.push({ type: 'tick', at: 100000 });
  expect(a.push({ type: 'manual_submit', at: 100001 })).toEqual([]);
});
it('提交后状态归零', () => { /* submit 之后 state().text === '' 且 startedAt === null */ });
it('一句话的静音不会重复提交', () => { /* 连续两次 tick 只产生一次 submit */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`turn-assembler.ts` 纯函数状态机（无 DOM，无计时器；时间由事件 `at` 传入，便于测试）：维护 `text`、`startedAt`、`lastSpeechAt`、`submitted`。`manual_submit` 有文本才提交（`reason: 'manual'`）；`tick` 先检查 90s 硬上限（`reason: 'timeout'`），再检查 `at - lastSpeechAt >= 2500`（`reason: 'silence'`）；提交后重置。

`useMicVad`：`MicVAD.new({ startOnLoad: false, model: 'v5', baseAssetPath: '/vad/', onnxWASMBasePath: '/vad/', ... })`（把 `@ricky0123/vad-web` 的 `dist/*.{js,wasm,onnx,worklet}` 拷到 `apps/web/public/vad/`）；`onFrameProcessed` 里 `onFrame(floatToInt16(frame))`；`onSpeechStart` → 发送 `utterance_start`；`onSpeechEnd` → `utterance_end`。麦克风权限失败 → 回调 `onDenied`，页面切文字模式并提示。

`useAsrSocket`：`ReconnectingWebSocket` 连 `${wsBase}/ws/asr?session=…`，二进制发送 PCM；收到 `asr_partial` 更新灰色字幕、`asr_final` 替换并喂给 `turnAssembler`、`asr_normalized` 淡入替换、`asr_error` 提示「实时字幕不可用」但保留按句识别。

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: 手动验证**：允许麦克风 → 说一句话 → 500ms 内出现灰字、停顿后 1.5s 内出终稿。

---

### Task 18: TTS 播放与打断

**Files:**
- Create: `apps/web/src/features/voice/tts-player.ts`、`features/voice/barge-in.ts`
- Modify: `InterviewPage.tsx`、`InterviewerAvatar.tsx`
- Test: `apps/web/src/features/voice/barge-in.test.ts`

**Interfaces:**
- Produces: `createBargeInDetector({ energyMs, threshold }): { feed(level: number, at: number): boolean; reset(): void }`、`TtsPlayer`（`push(chunk: Uint8Array)`、`end()`、`abort()`）。

- [ ] **Step 1: 写失败测试**

```ts
it('连续 300ms 超阈值才触发', () => {
  const d = createBargeInDetector({ energyMs: 300, threshold: 0.05 });
  expect(d.feed(0.1, 0)).toBe(false);
  expect(d.feed(0.1, 100)).toBe(false);
  expect(d.feed(0.1, 200)).toBe(false);
  expect(d.feed(0.1, 300)).toBe(true);
});
it('中途掉回阈值以下则重新计时', () => {
  const d = createBargeInDetector({ energyMs: 300, threshold: 0.05 });
  d.feed(0.1, 0); d.feed(0.01, 150); d.feed(0.1, 200); d.feed(0.1, 400);
  expect(d.feed(0.1, 450)).toBe(false);
});
it('触发一次后不重复触发，直到 reset', () => { /* ... */ });
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`TtsPlayer`：`MediaSource` + `SourceBuffer('audio/mp4; codecs="mp4a.40.2"')`（`mse-audio-wrapper` 把 mp3 转 fMP4）；`push` 时 `new MSEAudioWrapper('audio/mpeg')` → `iterator(chunk)` → `SourceBuffer.appendBuffer`；`isTypeSupported` 为 false 时降级：累积整个句子到 `Blob` 后 `audio.src = URL.createObjectURL(blob)`。`abort()`：`sourceBuffer.abort()`、清空队列、`audio.pause()`、`audio.currentTime = 0`。

页面联动：收到 `tts_start` 记 `turnId`；数字人说话期间 `bargeIn` 检测 + 实时 ASR partial 非空 → `player.abort()` + `POST /api/interview/:id/interrupt` + `useChat.stop()` + 当前消息打上 `interrupted` 标记。

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: 手动验证**：数字人说话中途开口 → 300ms 内静音；消息气泡显示「被打断」。

---

### Task 19: 报告页、雷达图与导出

**Files:**
- Create: `apps/web/src/pages/ReportPage.tsx`
- Modify: `apps/web/src/App.tsx`（路由：`/` setup、`/interview/:id`、`/report/:id`）
- Test: `apps/web/src/pages/ReportPage.test.tsx`

**Interfaces:**
- Consumes: Task 8 `InterviewReport`、Task 9 `toMarkdown`/`toJson`
- Produces: `ReportPage`、`downloadExport(blob, filename)`。

- [ ] **Step 1: 写失败测试**

```tsx
it('渲染五维雷达与三条建议', async () => {
  render(<ReportPage />);
  expect(await screen.findByTestId('radar')).toBeInTheDocument();
  expect(screen.getAllByTestId('action-item')).toHaveLength(3);
});
it('报告未生成时显示「生成中」并可重试', async () => { /* finish 返回 202 */ });
it('点导出触发 md 下载，文件名含日期', async () => {
  const spy = vi.spyOn(exporters, 'downloadExport');
  render(<ReportPage />);
  await userEvent.click(screen.getByRole('button', { name: /导出 Markdown/ }));
  expect(spy).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^interview-\d{4}-\d{2}-\d{2}-.+\.md$/));
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`ECharts` 雷达图用 `echarts.init` + `setOption`（不引额外 React 封装）。报告页分区：总分 + 雷达 → 好的地方（引用原话用引用块）→ 不足 → 需要提高（checkbox 样式列表）→ 逐题回看（折叠面板）。导出按钮两个，用 `file-saver` 的 `saveAs`。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 20: 端到端冒烟与文档

**Files:**
- Create: `README.md`
- Create: `scripts/smoke-interview.mjs`
- Create: `apps/server/src/interview/mock-mode.spec.ts`

**Interfaces:**
- Consumes: 前面全部
- Produces: 一条命令跑通文字面试；README 的验收清单。

- [ ] **Step 1: 写 mock 模式集成测试**

```ts
it('mock + 文本模式能连跑 3 轮并产出报告与导出', async () => {
  const app = await createTestApp({ speechMode: 'mock', model: scriptedModel });
  const { body } = await request(app.getHttpServer()).post('/api/interview')
    .send({ track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 }).expect(201);
  for (const text of ['第一轮回答', '第二轮回答', '第三轮回答']) {
    await request(app.getHttpServer()).post(`/api/interview/${body.id}/turn`).send({ text }).expect(200);
  }
  const r = await request(app.getHttpServer()).post(`/api/interview/${body.id}/finish`).expect(201);
  expect(r.body.report.dimensions).toHaveLength(5);
  const md = await request(app.getHttpServer()).get(`/api/interview/${body.id}/export?format=md`).expect(200);
  expect(md.text).toContain('第一轮回答');
});
```

- [ ] **Step 2: 跑测试确认失败 → 实现 → 通过**

若 `pipeUIMessageStreamToResponse` 与 supertest 配合有问题，用 `res` 原始流读取，或改为直接消费 `createTurnStream` 的 chunk 序列；不得为此改动生产代码的协议。

- [ ] **Step 3: 写 `scripts/smoke-interview.mjs`**

用 Node 内置 `fetch` 跑通「建会话 → 3 轮文字 → 结束 → 导出」，每步打印状态码与耗时，最后打印报告总分与建议条数。**不打印任何密钥**。

- [ ] **Step 4: 写 README**

包含：Node 20 切换命令、`node scripts/setup-env.mjs`、`pnpm install`、`pnpm dev`、`SPEECH_MODE=mock|live` 说明、耳机建议、已知限制（腾讯免费包只覆盖 `16k_zh`；英文术语可能识别错；刷新丢会话）、验收清单（设计稿 §8 的 7 条逐条打勾）。

- [ ] **Step 5: 全量检查**

Run: `pnpm -r typecheck && pnpm -r test`
Run: `node scripts/smoke-interview.mjs`
Expected: 全部通过，冒烟脚本输出 3 轮 transcript 与报告摘要。

---

## 自检记录

- **Spec 覆盖**：§4.1 开始页 → T15；§4.2 布局与 barge-in → T16/T18；§4.3 报告与导出 → T8/T9/T19；§5.1–5.4 出题维度、状态机、氛围、口述题 → T1/T2/T5；§6.1–6.5 → T3/T6/T10–T14/T17；§6.6 → T8；§6.7 密钥 → T3；§6.8 降级 → T10/T11/T13/T16；§8 验收 → T20；§11.1 提交时机 → T17；§11.2 打断 → T7/T14/T18；§11.3 控制行 → T4/T6；§11.4 评审题 → T2/T5/T13；§11.5 终稿时延 → T12/T17；§11.6 mock 模式 → T3/T11/T20。
- **类型一致性**：`DirectorCtrl` 在 T1 定义、T4 解析、T5 提示、T6 落库，字段名统一 `move/phase/asked`。`InterviewReport` 在 T8 定义，T9 导出、T19 渲染。`InterviewUIMessage` 在 T1 定义，T6 写、T16 读。
- **偏离设计稿处**：NestJS 由 11 改为 12.3.2（11 的 peer 与 `@nestjs/cli@12` 不匹配；12 要求 Node ≥20，本机满足）。设计稿 6.2 的「NestJS 11」需同步勘误。
- **Review Focus**：5 条均已在 T4/T6（控制行）、T17（空回答）、T7/T14/T18（打断）、T5/T13（代码不朗读）、T9（无报告导出）落成具体断言。
