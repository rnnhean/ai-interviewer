import { describe, expect, it } from 'vitest';
import { extractLastUserText, messageText, type InterviewUIMessage } from './messageText';

function userMessage(id: string, text: string): InterviewUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

describe('messageText', () => {
  it('拼出消息里的全部文本 part', () => {
    const msg: InterviewUIMessage = {
      id: 'a',
      role: 'assistant',
      parts: [
        { type: 'text', text: '先说' },
        { type: 'text', text: '结论。' },
      ],
    };
    expect(messageText(msg)).toBe('先说结论。');
  });

  it('取最后一条用户消息的文本', () => {
    const messages: InterviewUIMessage[] = [
      userMessage('1', '第一句'),
      { id: '2', role: 'assistant', parts: [{ type: 'text', text: '回应' }] },
      userMessage('3', '第二句'),
      { id: '4', role: 'assistant', parts: [{ type: 'text', text: '再回应' }] },
    ];
    expect(extractLastUserText(messages)).toBe('第二句');
  });

  it('消息里没有用户文本时返回空串', () => {
    const messages: InterviewUIMessage[] = [
      { id: '1', role: 'assistant', parts: [{ type: 'text', text: '只有面试官' }] },
    ];
    expect(extractLastUserText(messages)).toBe('');
    expect(extractLastUserText([])).toBe('');
  });

  it('忽略 data part，只取文本', () => {
    const msg: InterviewUIMessage = {
      id: 'x',
      role: 'user',
      parts: [
        { type: 'data-phase', data: { phase: 'project', askedInPhase: 2 } },
        { type: 'text', text: '  我的回答  ' },
      ],
    };
    expect(messageText(msg)).toBe('我的回答');
  });
});
