import { Injectable } from '@nestjs/common';
import { generateText, type LanguageModel } from 'ai';
import { NORMALIZE_TIMEOUT_MS } from '@ai-interviewer/shared';
import { LlmService } from '../llm/llm.service';

/** 面试里高频出现、语音识别最容易写错的词 */
export const GLOSSARY = [
  'React',
  'NestJS',
  'TypeScript',
  'Agent',
  'RAG',
  'rerank',
  'Embedding',
  'prompt',
  'function calling',
  'SSE',
  'WebSocket',
  'VAD',
];

const SYSTEM = `你是一个术语纠正器。输入是语音识别出来的一句话，可能把技术术语写错了（谐音、近音）。
请只做最小改动，把明显写错的技术术语改成正确写法：${GLOSSARY.join('、')}。
规则：
- 只输出纠正后的那句话，不要解释、不要加引号、不要换行
- 没有明显错误就原样输出
- 不要改写句式，不要补充内容`;

/**
 * 把 ASR 的字幕文本过一遍术语纠正。超时或失败都返回原文，
 * 因为字幕宁可保持原样，也不能因为一次纠正把用户说的话改没了。
 */
@Injectable()
export class TermNormalizer {
  private readonly timeoutMs: number;

  constructor(
    private readonly model: LanguageModel,
    timeoutMs = NORMALIZE_TIMEOUT_MS,
  ) {
    this.timeoutMs = timeoutMs;
  }

  static fromLlm(llm: LlmService): TermNormalizer {
    return new TermNormalizer(llm.model);
  }

  async normalize(text: string): Promise<string> {
    const trimmed = text.trim();
    if (trimmed.length < 2) return text;

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;

    try {
      // 双重保险：abortSignal 让真实模型停止请求，race 保证上游不响应时也能按时返回
      const call = generateText({
        model: this.model,
        system: SYSTEM,
        prompt: trimmed,
        temperature: 0,
        abortSignal: controller.signal,
      });
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, this.timeoutMs);
      });

      const result = await Promise.race([call, timeout]);
      if (!result) return text;

      const cleaned = result.text.trim().replace(/^["'“”]|["'“”]$/g, '');
      return cleaned === '' ? text : cleaned;
    } catch {
      return text;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}