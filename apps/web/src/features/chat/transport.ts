import { DefaultChatTransport } from 'ai';
import type { InterviewUIMessage } from './messageText';
import { extractLastUserText } from './messageText';

/**
 * 面试专用 transport：
 * - 回答走 `POST /api/interview/:id/turn`
 * - 开场白没有用户输入，走 `POST /api/interview/:id/opening`
 *
 * 复用 AI SDK 的 SSE 解析，不自己拆 data: 行。
 */
export class InterviewTransport extends DefaultChatTransport<InterviewUIMessage> {
  private opening = false;

  constructor(sessionId: string) {
    super({
      api: `/api/interview/${sessionId}/turn`,
      prepareSendMessagesRequest: ({ messages, body }) => {
        const text = extractLastUserText(messages);
        if (this.opening) {
          this.opening = false;
          return { api: `/api/interview/${sessionId}/opening`, body: {} };
        }
        return {
          body: {
            text,
            source: (body as { source?: 'voice' | 'text' } | undefined)?.source ?? 'text',
          },
        };
      },
    });
  }

  /** 下一次 sendMessages 打到开场白端点 */
  markOpening(): void {
    this.opening = true;
  }
}
