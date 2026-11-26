import { z } from 'zod';

/** 五维评分的 key，和 types.ts 的 DimensionKey 保持一致 */
export const DIMENSION_KEYS = [
  'technical',
  'decomposition',
  'tradeoff',
  'verification',
  'communication',
] as const;

export const DIMENSION_LABEL: Record<(typeof DIMENSION_KEYS)[number], string> = {
  technical: '技术深度',
  decomposition: '问题拆解',
  tradeoff: '方案权衡',
  verification: '验证意识',
  communication: '表达结构',
};

/**
 * 报告结构。维度固定五项、顺序固定，前端雷达图的轴才不会跳。
 * 分数是 1–10 的整数，total 是 0–100 的整数。
 */
export const ReportSchema = z.object({
  total: z.number().int().min(0).max(100).describe('总分，0-100'),
  dimensions: z
    .array(
      z.object({
        key: z.enum(DIMENSION_KEYS),
        score: z.number().int().min(1).max(10),
        comment: z.string().min(4).max(120).describe('这一维的评价，一句话'),
      }),
    )
    .length(5)
    .describe('五个维度，顺序无关但必须各出现一次'),
  strengths: z
    .array(
      z.object({
        quote: z.string().min(2).max(120).describe('候选人原话片段'),
        why: z.string().min(4).max(160).describe('为什么这是加分项'),
      }),
    )
    .min(3)
    .max(5),
  gaps: z
    .array(
      z.object({
        quote: z.string().min(2).max(120).describe('候选人原话片段'),
        issue: z.string().min(4).max(160).describe('这句话暴露的问题'),
        suggestion: z.string().min(4).max(200).describe('下次该怎么答'),
      }),
    )
    .min(3)
    .max(5),
  actions: z.array(z.string().min(6).max(160)).length(3).describe('三条可执行的改进动作'),
});

export type ReportPayload = z.infer<typeof ReportSchema>;