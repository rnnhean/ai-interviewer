import type { UIMessage } from 'ai';
import type { InterviewDataParts } from '@ai-interviewer/shared';

/** 面试页使用的消息类型：data parts 与后端 `InterviewDataParts` 对齐 */
export type InterviewUIMessage = UIMessage<unknown, InterviewDataParts>;

/** 拼出一条消息里所有文本 part */
export function messageText(message: InterviewUIMessage): string {
  return message.parts
    .filter((p): p is Extract<(typeof message.parts)[number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim();
}

/** 取最后一条用户消息的文本；没有则返回空串 */
export function extractLastUserText(messages: InterviewUIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === 'user') return messageText(m);
  }
  return '';
}

/** 取最后一条助手消息里的 data part（用于渲染进度等） */
export function lastDataPart<T extends InterviewDataParts[keyof InterviewDataParts]>(
  messages: InterviewUIMessage[],
  name: keyof InterviewDataParts,
): T | undefined {
  const type = `data-${name}`;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j];
      if (part && part.type === type && 'data' in part) return part.data as T;
    }
  }
  return undefined;
}
