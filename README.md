# AI 数字人面试官

一个可以本地跑起来的 AI 面试项目：数字人当面试官，你当候选人。支持**语音 + 文字**双向交流，语音时页面实时显示字幕，面试官的话会以流式 TTS 念出来。面试结束生成一份带 5 维评分、引用你原话的报告，可导出 Markdown / JSON。

面向的岗位是**前端转 Agent 开发**，也内置了「Agent 开发工程师」「后端 + AI 工程化」两个方向。

---

## 快速开始

### 1. 切到 Node 20

本机 bash 默认是 Node 16，必须切到 20（NestJS 12 / Vite 8 都要求 ≥ 20）：

```bash
# 用 nvm-windows
nvm use 20.19.5

# 或者临时在 bash 里前置 PATH
export PATH="/c/Users/v-renhan/AppData/Local/nvm/v20.19.5:$PATH"
```

验证：`node -v` 应输出 `v20.x`。

> `.nvmrc` 里写的是 `22.23.3`，本机也装了 22；用 `nvm use 22.23.3` 同样可以，只是本文档按 20 写的。

### 2. 安装依赖

```bash
pnpm install
```

### 3. 生成配置与静态资源

```bash
pnpm setup          # = setup:env + setup:vad
```

- `setup:env` 会从 `D:/20260916/knowledge-hub-backend/.env` 取 LLM Key、从 `C:/Users/v-renhan/Downloads/SecretKey.csv` 取腾讯云 SecretId/SecretKey，写入 `apps/server/.env`。**已有的值不会被覆盖**。脚本只打印键名，不打印任何值。
- `setup:vad` 把语音活动检测（VAD）需要的 onnx 模型和 wasm 拷到 `apps/web/public/vad/`。这个目录在 `.gitignore` 里，新克隆的仓库不跑这一步，麦克风按钮点下去会 404。

两个脚本都能单独跑：`pnpm setup:env` / `pnpm setup:vad`。

### 4. 启动

```bash
pnpm dev
```

- 前端 http://localhost:5273
- 后端 http://localhost:3101
- 语音通道 `ws://localhost:3101/ws/asr`、`/ws/tts`

首次启动看后端日志，应该出现：

```
[config]
LLM: 已配置
腾讯 ASR: 已配置
终稿校正: 已配置
TTS(edge): 已配置
语音模式: mock
端口: 3101
```

出现「缺少配置」就去补 `apps/server/.env`。

### 5. 冒烟测试（可选）

不开浏览器，直接验证「建会话 → 开场白 → 3 轮问答 → 评价 → 导出」整条链路：

```bash
pnpm smoke
```

只打印状态码、耗时、事件类型与文本长度，不打印任何密钥。

---

## 语音模式：mock 与 live

`.env` 里的 `SPEECH_MODE` 控制语音链路的真实程度：

| 值 | 行为 | 用在哪 |
|---|---|---|
| `mock` | 麦克风音频照传，但服务端返回**固定句子**的逐字 partial；TTS 照常真实合成 | 日常开发、e2e、不想消耗腾讯额度 |
| `live` | 真实调用腾讯云实时 ASR（`16k_zh`）+ DashScope 终稿校正 | 验收 |

切到 live 后重启后端，页面上的 ASR 状态提示会从「语音识别（演示模式）」变成「语音识别」。

**mock 模式下你对着麦克风说什么，字幕都会是那句预置话术**——这是预期行为，不是 bug。

---

## 面试流程

1. **开始页**：选方向（前端转 Agent / Agent 开发工程师 / 后端 + AI）、面试氛围（温和引导 / 标准 / 压力面）、时长（15 / 25 / 40 分钟）。
2. **面试页**：数字人开场提问。你可以
   - 打字回答，`Ctrl+Enter` 或点「发送」提交；
   - 点麦克风用语音回答，页面实时显示字幕，说完可以点「说完了」立即提交；
   - 数字人说话时你开口，会**自动打断**（barge-in），播放立刻停。
3. **报告页**：5 维雷达图 + 总分 + 好的地方 / 不足 / 需要提高（各 3 条）+ 逐题回看。可导出 Markdown 或 JSON。

氛围差异是肉眼可见的：

| 氛围 | 追问层数上限 | 压力 |
|---|---|---|
| 温和引导 | 1 层，答不上来给提示 | 低 |
| 标准 | 2 层 | 中 |
| 压力面 | 3 层，会催时间 | 高 |

---

## 建议戴耳机

不戴耳机时，面试官的声音会从扬声器出来被麦克风收进去，VAD 会把它当成你在说话，进而触发打断。戴耳机是最省事的解决办法。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + antd 6 + zustand + echarts |
| 后端 | NestJS 12 + ws 8 |
| LLM | Vercel AI SDK 7 + DashScope（qwen-plus，OpenAI 兼容模式） |
| ASR | 腾讯云实时语音识别 `16k_zh`；终稿用 qwen3-asr-flash 二次校正 |
| TTS | `msedge-tts` 流式 MP3 → `mse-audio-wrapper` 包 fMP4 → MediaSource 边收边播 |
| VAD | `@ricky0123/vad-web`（silero） |
| 数字人形象 | DiceBear（Draftbit Personas 风格）生成的 SVG 头像 |
| 测试 | vitest 5 + supertest + Testing Library |

几个实现上值得知道的点：

- **结构化输出走工具调用**。DashScope 的 qwen 系列不支持 `responseFormat` 形式的 JSON schema 输出，报告生成改成让模型调用 `submitReport` 工具，`toolChoice` 强制指定。
- **一轮一个 TtsPlayer**。MediaSource `endOfStream()` 之后不能再 append，所以每次换轮次就重建播放器；同一轮的多个音频分片复用同一个。
- **打断是三层一起停**：本地播放器 abort、服务端 `/interrupt` 中止 LLM 流、WebSocket 发 `barge_in`。
- **每句话开头补 pad 帧**。`onFrameProcessed` 早于语音判定触发，不加缓冲会丢掉第一个字。
- **数字人头像不换嘴做口型**。DiceBear 的插画只有 smile / surprised 这类整表情，没有「半张嘴」的中间态，按音量硬切会变成脸在抽搐。说话时改用实时音量驱动外圈光环扩散、头像浮动和音量条，效果更稳。

---

## 已知限制

- **刷新页面会丢会话**。会话存在服务端内存里，刷新后前端拿不到对话记录，页面会明确提示。设计上不落数据库。
- **腾讯实时 ASR 的 `live` 链路**在代码里写好了帧头/结束帧的组装，并有单测覆盖协议层，但**尚未用真实账号跑过端到端验收**。第一次跑 live 建议先试一句短话。
- **英文技术词仍可能识别错**。有术语归一（把谐音改回 React / RAG / rerank 这类），但归一超时 800ms 就放弃，不阻塞后续。
- **`msedge-tts` 依赖微软的公开接口**，没有 SLA，偶发失败时前端会自动退回浏览器 `speechSynthesis`（音色会变）。
- **报告模型偶发不听话**。已做两次重试 + 结构校验，仍失败会返回一份明确标注 `fallback: true` 的降级报告（基准 60 分），不会假装是模型给的。
- 会话不做持久化，进程重启后所有会话消失。

---

## 验收清单

对照设计稿 §8 逐条。**已实测**和**仅单测覆盖**分开写，不混着勾：

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 纯文字模式能完成 ≥ 8 轮面试，围绕岗位追问不跑题 | 部分：实测 3 轮，阶段正常推进 `intro → project`；≥ 8 轮未跑 |
| 2 | 语音：500ms 内灰色实时字幕；停顿 1.5s 出终稿；TTS 首包 < 1.5s | partial 逐字增长已实测（mock 链路）；TTS 首包 563ms 是设计阶段本机实测值；**停顿 1.5s 出终稿未实测**（依赖 live ASR） |
| 3 | 数字人说话时用户开口，300ms 内停止播放 | 仅单测覆盖（`barge_in` 同步 abort 播放器 + 通知服务端）；**浏览器真实麦克风下的端到端延迟未实测** |
| 4 | 结束后面试 60 秒内生成报告，含 5 维 + 引用原话 + 3 条建议 | 已实测：两次冒烟分别 18.3s / 17.5s，结构齐全 |
| 5 | 压力面与温和引导在追问次数、打断行为上有肉眼可见差异 | 追问层数已测（1 / 2 / 3 层硬上限 + 服务端兜底推进）；打断行为的氛围差异**未实测** |
| 6 | 导出的 Markdown 与 JSON 均含完整 transcript 与完整报告，文件名含方向与日期 | 已实测：md 2278–6462 字节 / json 3080–6106 字节，文件名形如 `interview-2026-11-04-frontend-to-agent.md` |
| 7 | 仓库与日志中不出现任何密钥 | 已扫描：`.env` 在 gitignore；`setup:env` 只打印键名；启动日志只报「已配置 / 缺失」；源码里命中的都是测试假值（`sk-test-…` / `AKIDxxxx…`） |

浏览器端完整走查（Chromium）：开始页 → 3 轮问答 → 结束 → 报告页 → 导出 md/json，页面错误 0，控制台错误 0。

上表里标「未实测」的三项都需要 `SPEECH_MODE=live` + 真实麦克风，见「已知限制」第二条。

---

## 目录结构

```
apps/
  server/                 NestJS 后端
    src/
      interview/          会话状态机、轮次生成、控制器
      llm/                模型封装、控制行解析、TTS 分句、提示词
      asr/                腾讯实时 ASR 客户端、终稿校正、术语归一
      tts/                分片合成与推送
      realtime/           /ws/asr 与 /ws/tts 挂载
      report/             评价生成（工具调用式结构化输出）+ 降级
      export/             导出控制器与 md/json 渲染
  web/                    React 前端
    src/
      pages/              开始页 / 面试页 / 报告页
      features/chat/      流式对话
      features/voice/     VAD、TTS 播放器、语音会话、字幕
      export/             浏览器端下载
    public/vad/           VAD 静态资源（由 setup:vad 生成，不入库）
packages/shared/          前后端共用的类型、schema、阶段计划
scripts/
  setup-env.mjs           从 .env / CSV 生成 apps/server/.env（只打印键名）
  copy-vad-assets.mjs     从 node_modules 拷 VAD 资源
  smoke-interview.mjs     不开浏览器的端到端冒烟
```

---

## 常用命令

```bash
pnpm dev             # 前后端一起起
pnpm test            # 全部单测
pnpm typecheck       # 全部类型检查
pnpm smoke           # 端到端冒烟（需后端已启动）
pnpm setup:env       # 重新生成 apps/server/.env
pnpm setup:vad       # 重新拷贝 VAD 静态资源
```

单跑某个包的测试：

```bash
cd apps/server && ./node_modules/.bin/vitest run
cd apps/web && ./node_modules/.bin/vitest run
```
