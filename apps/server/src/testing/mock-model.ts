import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';

/**
 * 测试用的假模型。AI SDK 7 的 mock 要求 finishReason / usage 用协议内部结构，
 * 这里集中写一次，别在每个 spec 里重复。
 */
const FINISH = { unified: 'stop' as const, raw: 'stop' };
const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** 按固定切片吐一段文本的模型（模拟流式） */
export function modelSaying(text: string, parts = 4): LanguageModel {
  const step = Math.max(1, Math.ceil(text.length / parts));
  const deltas: string[] = [];
  for (let i = 0; i < text.length; i += step) deltas.push(text.slice(i, i + step));

  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'text-start' as const, id: 't' },
        ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
        { type: 'text-end' as const, id: 't' },
        { type: 'finish' as const, finishReason: FINISH, usage: USAGE },
      ]),
    }),
  }) as unknown as LanguageModel;
}

/** 一次生成返回一段文本（用于 generateText） */
export function modelAnswering(text: string): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: FINISH,
      usage: USAGE,
      warnings: [],
    }),
  }) as unknown as LanguageModel;
}

/** 一次生成返回 JSON（用于结构化输出） */
export function modelReturningJson(value: unknown): LanguageModel {
  return modelAnswering(JSON.stringify(value));
}

/** 一次生成返回一次工具调用（用于工具式结构化输出） */
export function modelCallingTool(toolName: string, input: unknown): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'call-1',
          toolName,
          input: JSON.stringify(input),
        },
      ],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
      usage: USAGE,
      warnings: [],
    }),
  }) as unknown as LanguageModel;
}

/** 永远失败 */
export function brokenModel(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error('boom');
    },
    doStream: async () => {
      throw new Error('boom');
    },
  }) as unknown as LanguageModel;
}

/** 永远不返回（测超时） */
export function silentModel(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: () => new Promise(() => undefined),
    doStream: () => new Promise(() => undefined),
  }) as unknown as LanguageModel;
}