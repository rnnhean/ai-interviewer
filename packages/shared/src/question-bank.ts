import type { ActivePhase, QuestionItem } from './types';

/**
 * 预置题包。每个能力维度 ≥2 道，覆盖五个阶段。
 * displayText 可含代码，只展示；speechText 是口播文本，绝不含代码围栏。
 */
export const QUESTION_BANK: QuestionItem[] = [
  // ── intro：自我介绍与动机 ────────────────────────────────
  {
    id: 'intro-1',
    dimension: 'communication',
    phase: 'intro',
    displayText: '',
    speechText: '先用一两分钟说说你自己，重点讲跟 Agent 相关的部分，不用从头讲学校。',
  },
  {
    id: 'intro-2',
    dimension: 'communication',
    phase: 'intro',
    displayText: '',
    speechText: '你为什么想从前端转做 Agent 开发？说一个你真正动手做过的东西。',
  },
  {
    id: 'intro-3',
    dimension: 'decomposition',
    phase: 'intro',
    displayText: '',
    speechText: '你最近半年写过的最复杂的一个功能是什么？用一句话讲清它解决什么问题。',
  },

  // ── project：项目深挖 ───────────────────────────────────
  {
    id: 'proj-rag-1',
    dimension: 'technical',
    phase: 'project',
    displayText: '',
    speechText: '你说做过知识库，那用户问一个文档里根本没有的问题时，你的系统应该怎么表现？',
  },
  {
    id: 'proj-rag-2',
    dimension: 'tradeoff',
    phase: 'project',
    displayText: '',
    speechText: '切分策略你选的什么？为什么不是另一种？说一个你因此吃过亏的例子。',
  },
  {
    id: 'proj-stream-1',
    dimension: 'technical',
    phase: 'project',
    displayText: '',
    speechText: '你的流式对话是怎么实现的？断网重连的时候用户会看到什么？',
  },
  {
    id: 'proj-tool-1',
    dimension: 'technical',
    phase: 'project',
    displayText: '',
    speechText: '你项目里的工具调用失败过吗？失败之后你怎么让模型知道它失败了？',
  },
  {
    id: 'proj-migrate-1',
    dimension: 'communication',
    phase: 'project',
    displayText: '',
    speechText: '从写组件转到设计工作流，你觉得最大的思维转变是什么？举个具体例子。',
  },
  {
    id: 'proj-tool-2',
    dimension: 'decomposition',
    phase: 'project',
    displayText: '',
    speechText: '如果让你现在重做一遍那个项目，你会砍掉哪一块？为什么当时没砍。',
  },
  {
    id: 'proj-evidence-1',
    dimension: 'verification',
    phase: 'project',
    displayText: '',
    speechText: '你怎么知道你的 Agent 比上一版变好了？给出你实际用过的验证方式。',
  },

  // ── fundamentals：能力维度的基本原理 ─────────────────────
  {
    id: 'fund-ctx-1',
    dimension: 'decomposition',
    phase: 'fundamentals',
    displayText: '',
    speechText: '如果一个需求是「让 Agent 帮我处理客服工单」，你会先问哪三个问题再动手？',
  },
  {
    id: 'fund-tool-1',
    dimension: 'technical',
    phase: 'fundamentals',
    displayText: '',
    speechText: 'function calling 和 ReAct 的区别是什么？各自的失败模式是什么？',
  },
  {
    id: 'fund-rag-1',
    dimension: 'technical',
    phase: 'fundamentals',
    displayText: '',
    speechText: 'RAG 里 rerank 的作用是什么？什么情况下加了反而更差？',
  },
  {
    id: 'fund-eval-1',
    dimension: 'verification',
    phase: 'fundamentals',
    displayText: '',
    speechText: '你怎么评估一个 RAG 系统的召回质量？没有标注数据的时候怎么办？',
  },
  {
    id: 'fund-cost-1',
    dimension: 'tradeoff',
    phase: 'fundamentals',
    displayText: '',
    speechText: '一个 Agent 每次调用花 30 秒、两毛钱，用户嫌慢，你会从哪几个方向压？',
  },
  {
    id: 'fund-prompt-1',
    dimension: 'decomposition',
    phase: 'fundamentals',
    displayText: '',
    speechText: '给 Agent 的上下文不是越多越好，你怎么决定塞什么、丢什么？',
  },
  {
    id: 'fund-obs-1',
    dimension: 'verification',
    phase: 'fundamentals',
    displayText: '',
    speechText: '线上 Agent 输出突然变差，你怎么定位是模型、提示还是数据的问题？',
  },
  {
    id: 'fund-safety-1',
    dimension: 'tradeoff',
    phase: 'fundamentals',
    displayText: '',
    speechText: 'Agent 要调用写操作的接口，你会加哪几层保护？按重要性排。',
  },

  // ── scenario：评审题，带代码/需求展示 ───────────────────
  {
    id: 'sce-code-1',
    dimension: 'verification',
    phase: 'scenario',
    displayText: [
      '```ts',
      'async function ask(prompt: string) {',
      '  const r = await fetch(URL, {',
      '    method: "POST",',
      '    body: JSON.stringify({ prompt }),',
      '  });',
      '  return r.json();',
      '}',
      '```',
      '上线前你会先改哪一处？为什么？',
    ].join('\n'),
    speechText: '屏幕上这段调用 AI 的代码是实习生写的，你先看一眼，说说上线前你会先改哪一处，为什么。',
  },
  {
    id: 'sce-code-2',
    dimension: 'technical',
    phase: 'scenario',
    displayText: [
      '```ts',
      'for (const doc of documents) {',
      '  await embed(doc);',
      '}',
      '```',
      '这段跑一万份文档要很久。你会怎么改？改完引入什么新问题？',
    ].join('\n'),
    speechText: '屏幕上这段是批量向量化的循环，一万份文档要跑很久。你会怎么改，改完又会引入什么新问题？',
  },
  {
    id: 'sce-prompt-1',
    dimension: 'decomposition',
    phase: 'scenario',
    displayText: [
      '需求：让 coding agent 给现有项目加一个「导出 Excel」功能。',
      '',
      '请口述你这一轮会写什么提示词，包含目标、约束、验收标准、禁止项。',
    ].join('\n'),
    speechText: '现在有个需求，让 coding agent 给现有项目加一个导出 Excel 的功能。你口述一下这一轮你会给它写什么提示词，目标、约束、验收、禁止项都要有。',
  },
  {
    id: 'sce-arch-1',
    dimension: 'decomposition',
    phase: 'scenario',
    displayText: [
      '需求：客服 Agent，能查订单、能改地址、能退款。',
      '',
      '请用语言描述目录结构、数据流、失败兜底。',
    ].join('\n'),
    speechText: '需求是一个客服 Agent，能查订单、改地址、退款。你用嘴描述一下目录结构、数据流，还有最关键的失败兜底。',
  },
  {
    id: 'sce-review-1',
    dimension: 'tradeoff',
    phase: 'scenario',
    displayText: [
      '```ts',
      'const messages = [',
      '  { role: "system", content: SYSTEM },',
      '  ...allHistory,',
      '  { role: "user", content: input },',
      '];',
      '```',
      '这段代码跑三个月后会出什么问题？',
    ].join('\n'),
    speechText: '屏幕上这段是把全部历史都塞进上下文。你判断一下，这样跑三个月会出什么问题。',
  },

  // ── reverse：候选人反问 ─────────────────────────────────
  {
    id: 'reverse-1',
    dimension: 'communication',
    phase: 'reverse',
    displayText: '',
    speechText: '最后你有什么想问我的？关于团队怎么用 Agent、或者这个岗位的日常工作都行。',
  },
  {
    id: 'reverse-2',
    dimension: 'communication',
    phase: 'reverse',
    displayText: '',
    speechText: '你还有什么想补充的，或者觉得我刚才没问到的？',
  },
  {
    id: 'reverse-3',
    dimension: 'tradeoff',
    phase: 'reverse',
    displayText: '',
    speechText: '如果这个岗位要你在三个月内交付一个能用的 Agent，你会先做什么，先放弃什么？',
  },
];

/** 从某阶段挑一道没用过的题；都用过则返回 null */
export function pickQuestion(phase: ActivePhase, usedIds: readonly string[]): QuestionItem | null {
  const used = new Set(usedIds);
  return QUESTION_BANK.find((q) => q.phase === phase && !used.has(q.id)) ?? null;
}
