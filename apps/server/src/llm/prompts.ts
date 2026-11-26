import {
  FOLLOW_UP_LIMIT,
  NUDGE_MS,
  phasePlan,
  SILENCE_PROMPT_MS,
  type Atmosphere,
  type QuestionItem,
  type SessionSnapshot,
  type Track,
} from '@ai-interviewer/shared';

const TRACK_LABEL: Record<Track, string> = {
  'agent-engineer': 'Agent 开发工程师（有经验）',
  'frontend-to-agent': '前端转 Agent 开发（重点考察迁移能力）',
  'backend-ai': '后端 + AI（重点考察工程化与稳定性）',
};

const PHASE_LABEL: Record<string, string> = {
  intro: '开场与自我介绍',
  project: '项目深挖',
  fundamentals: '能力维度原理',
  scenario: '场景评审与口述设计',
  reverse: '候选人反问',
  done: '结束',
};

/** 三档氛围的行为差异，逐字对应设计稿 5.3 的表 */
const ATMOSPHERE: Record<Atmosphere, string[]> = {
  gentle: [
    '追问最多 1 层追问，问完就换题。',
    '候选人答不上来时给一个提示，或者换个角度重新问，不要施压。',
    '不要打断候选人，等他说完。',
    '要求量化是可选项，没给也不用追。',
    `${SILENCE_PROMPT_MS.gentle / 1000} 秒没动静再主动引导。`,
    '整体语气友好，像同事之间聊技术。',
  ],
  standard: [
    '最多 2 层追问。',
    '候选人答不上来时提醒一次，再换题。',
    `超过 ${NUDGE_MS.standard / 1000} 秒提醒一次注意时间。`,
    '经常要求候选人给具体数字或取舍。',
    `${SILENCE_PROMPT_MS.standard / 1000} 秒没动静主动引导。`,
    '语气专业、克制。',
  ],
  pressure: [
    '2 到 3 层追问，追问要往下挖到候选人答不出来为止。',
    '候选人答不上来时可以直接质疑你是不是没做过，但不要人身攻击。',
    `超过 ${NUDGE_MS.pressure / 1000} 秒要求先给结论。`,
    '必须给数字和取舍，含糊其辞就当面指出。',
    `${SILENCE_PROMPT_MS.pressure / 1000} 秒没动静就催。`,
    '语气严厉但不失礼。',
  ],
};

const MAX_FOLLOW_UP_LINE = (a: Atmosphere) => `本轮最多 ${FOLLOW_UP_LIMIT[a]} 层追问。`;

export interface BuildPromptInput {
  snapshot: SessionSnapshot;
  question?: QuestionItem;
}

/**
 * 组装单轮 system prompt。
 * 输出格式约定固定写在最后，模型必须遵守，否则服务端走兜底。
 */
export function buildSystemPrompt(input: BuildPromptInput): string {
  const { snapshot: s, question } = input;
  const plan = phasePlan(s.durationMin)[s.phase as keyof ReturnType<typeof phasePlan>];
  const quotaLine = plan
    ? `本阶段题量 ${plan.min}–${plan.max}，已出 ${s.askedInPhase} 题，已追问 ${s.followUps} 层。`
    : '当前处于收尾阶段。';

  const blocks: string[] = [];

  blocks.push(
    [
      '# 角色',
      '你是一线 Agent 团队的技术负责人，面试经验很多。',
      '你考察的是判断力和真实经验，不是背诵。候选人说套话时你会追问具体例子。',
      '',
      `# 岗位方向`,
      TRACK_LABEL[s.track],
      '',
      `# 当前阶段`,
      `${PHASE_LABEL[s.phase] ?? s.phase}（${s.phase}）`,
      quotaLine,
      MAX_FOLLOW_UP_LINE(s.atmosphere),
      '',
      `# 面试氛围：${atmosphereLabel(s.atmosphere)}`,
      ...ATMOSPHERE[s.atmosphere].map((l) => `- ${l}`),
    ].join('\n'),
  );

  blocks.push(
    [
      '# 口播硬约束',
      '- 每次只说 2–4 句，必须开口说话，不要用列表或标题。',
      '- 先给结论或直接提问，不要铺垫。',
      '- 不要讲课，不要自问自答，不要一次抛出多个问题。',
      '- 代码只用于展示，不要朗读代码。',
      '- 候选人是在用嘴说话，你的回复也要能被自然朗读出来。',
    ].join('\n'),
  );

  if (question) {
    blocks.push(
      [
        '# 本轮题目',
        `口播引导语（这是你要说的话的种子，可自然改写）：${question.speechText}`,
        question.displayText
          ? `页面同时展示以下内容，候选人能看到，你**不要朗读代码**，只是指着它说话：\n${question.displayText}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (s.resumeText && s.resumeText.trim()) {
    blocks.push(['# 候选人简历摘要（可能不完整）', s.resumeText.trim()].join('\n'));
  }

  if (s.rounds.length > 0) {
    const recent = s.rounds.slice(-6);
    blocks.push(
      [
        '# 已经问过的轮次（不要重复问同样的问题）',
        ...recent.map((r) => `第 ${r.index} 轮｜问：${clip(r.question, 80)}｜答：${clip(r.answer, 120)}`),
      ].join('\n'),
    );
  }

  blocks.push(
    [
      '# 输出格式（必须严格遵守）',
      '第一行必须是控制行，然后一个空行，再开始说正文。控制行示例：',
      '<<CTRL {"move":"follow_up","phase":"project","asked":3}>>',
      '控制行必须以两个右尖括号 >> 结尾，不要只写一个 >。',
      '',
      '字段说明：',
      '- move：follow_up 表示继续追问本轮；advance 表示换新题或进入下一阶段；close 表示面试该结束了。',
      '- phase：当前所处阶段，取值 intro / project / fundamentals / scenario / reverse / done。',
      '- asked：本阶段出过多少道题（追问不增加这个数）。',
      '',
      '控制行之后不要解释、不要重复控制行，直接开始说你要对候选人讲的话。',
    ].join('\n'),
  );

  return blocks.join('\n\n');
}

function atmosphereLabel(a: Atmosphere): string {
  return a === 'gentle' ? '温和引导' : a === 'pressure' ? '压力面' : '标准';
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/**
 * 只保留能朗读的部分：删掉围栏代码块与行内反引号。
 * 用在 TTS 与「口播文本」两处。
 */
export function speechOnly(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
