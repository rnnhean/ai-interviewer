import { Inject, Injectable } from '@nestjs/common';
import { generateText, Output } from 'ai';
import {
  DIMENSION_KEYS,
  DIMENSION_LABEL,
  ReportSchema,
  type DimensionKey,
  type DimensionScore,
  type Gap,
  type InterviewReport,
  type ReportPayload,
  type SessionSnapshot,
  type Strength,
} from '@ai-interviewer/shared';
import { LlmService } from '../llm/llm.service';

const SYSTEM = `你是资深前端 / Agent 开发岗位的面试评审。
读完这场面试的逐轮记录，给候选人出一份诚实的评价，不是客套的鼓励。

评分口径（1-10 分）：
- technical 技术深度：原理是否讲对，边界是否清楚
- decomposition 问题拆解：有没有先把问题拆开再动手
- tradeoff 方案权衡：能不能说出为什么选这个方案、代价是什么
- verification 验证意识：怎么证明做出来的东西是对的
- communication 表达结构：是否先给结论、有没有答偏

硬性要求：
- dimensions 必须恰好 5 条，key 只能是 technical / decomposition / tradeoff / verification / communication，各出现一次
- strengths 和 gaps 各 3-5 条，quote 必须是候选人原话片段，不许自己编造没出现过的话
- 候选人答得含糊就直说，不要因为语气温和就抬高分数
- actions 恰好 3 条，每条写成一个下次能直接照做的动作，例如「回答前先用一句话给结论，再展开两点论据」
- 如果候选人几乎没有有效回答，就按实际表现给低分，不要为了凑格式编内容`;

@Injectable()
export class ReportService {
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  /** 生成评价报告；模型失败重试一次，仍失败走降级 */
  async generate(snapshot: SessionSnapshot): Promise<InterviewReport> {
    const prompt = buildReportPrompt(snapshot);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // 走工具调用而不是 responseFormat：DashScope 的 qwen 系列不支持
        // JSON schema 形式的 structured output，工具调用才是通用路径
        const result = await generateText({
          model: this.llm.model,
          system: SYSTEM,
          prompt,
          temperature: 0.2,
          tools: {
            submitReport: {
              description: '提交这场面试的评价报告',
              inputSchema: ReportSchema,
              execute: async (report: ReportPayload) => report,
            },
          },
          toolChoice: { type: 'tool', toolName: 'submitReport' },
        });

        const call = result.toolCalls[0];
        if (call?.input) return orderDimensions(ReportSchema.parse(call.input));
        logAttempt(attempt, new Error('模型没有调用 submitReport'));
      } catch (err) {
        logAttempt(attempt, err);
      }
    }

    return this.fallback(snapshot);
  }

  /** 降级报告：结构完整、分数保守，明确标注是降级产物 */
  fallback(snapshot: SessionSnapshot): InterviewReport {
    const answered = snapshot.rounds.filter((r) => r.answer.trim() !== '');
    const recent = answered.slice(-3);

    const strengths: Strength[] = padTo(
      recent.map((r) => ({
        quote: clip(r.answer, 40),
        why: '这段回答有具体内容，至少说清了自己做了什么。',
      })),
      3,
      (i) => ({
        quote: `第 ${i + 1} 轮回答`,
        why: '有作答记录，但本轮评价未能生成，暂按基准给分。',
      }),
    ).slice(0, 3);

    const gaps: Gap[] = padTo(
      recent.map((r) => ({
        quote: clip(r.answer, 40),
        issue: '本轮评价未能生成，暂时按「结论先行 + 论据收敛」的通用标准衡量。',
        suggestion: '复述时先给一句结论，再用两点论据支撑，最后补一句代价。',
      })),
      3,
      (i) => ({
        quote: `第 ${i + 1} 轮回答`,
        issue: '缺少可对照的自动评价，无法定位具体问题。',
        suggestion: '下次回答后用一句话自评：结论、论据、代价各一句。',
      }),
    ).slice(0, 3);

    const dimensions: DimensionScore[] = DIMENSION_KEYS.map((key) => ({
      key,
      score: 6,
      comment: `${DIMENSION_LABEL[key]}：评价模型本轮未返回结果，按基准分计。`,
    }));

    return {
      total: 60,
      dimensions,
      strengths,
      gaps,
      actions: [
        '每个回答先给一句结论，再展开不超过两点论据，控制在 1 分钟内。',
        '准备一个最能代表自己水平的项目，把背景、你做的决策、结果数字记熟。',
        '遇到不会的问题先说思路再说不确定的部分，不要沉默或直接跳到答案。',
      ],
      fallback: true,
    };
  }
}

function buildReportPrompt(snapshot: SessionSnapshot): string {
  const transcript = snapshot.rounds.map((r) => ({
    轮次: r.index,
    面试官问: r.question,
    候选人答: r.answer,
    作答方式: r.source === 'voice' ? '语音' : '文字',
    被打断: r.interrupted,
  }));

  return [
    `面试方向：${snapshot.track}`,
    `面试氛围：${snapshot.atmosphere}`,
    `计划时长：${snapshot.durationMin} 分钟`,
    `实际出题数：${snapshot.askedTotal}`,
    '',
    '逐轮记录（JSON）：',
    JSON.stringify(transcript, null, 2),
  ].join('\n');
}

/** 把模型给的维度按固定顺序排好，前端雷达图轴才稳定 */
function orderDimensions(payload: ReportPayload): InterviewReport {
  const byKey = new Map<DimensionKey, DimensionScore>();
  for (const d of payload.dimensions) {
    if (!byKey.has(d.key)) byKey.set(d.key, { key: d.key, score: d.score, comment: d.comment });
  }

  const dimensions = DIMENSION_KEYS.map(
    (key) => byKey.get(key) ?? { key, score: 5, comment: `${DIMENSION_LABEL[key]}：模型未给出该项。` },
  );

  return {
    total: payload.total,
    dimensions,
    strengths: payload.strengths,
    gaps: payload.gaps,
    actions: payload.actions,
  };
}

function padTo<T>(items: T[], size: number, make: (index: number) => T): T[] {
  const out = [...items];
  while (out.length < size) out.push(make(out.length));
  return out;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function logAttempt(attempt: number, err: unknown): void {
  // 只打错误类型名，不打 prompt / 原始响应，避免回答内容和密钥进日志
  const name = (err as Error)?.name ?? 'Error';
  console.warn(`[report] 第 ${attempt + 1} 次生成失败：${name}`);
}