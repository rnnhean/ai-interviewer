import { useCallback, useMemo, useRef } from 'react';
import { DefaultChatTransport, parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from 'ai';
import { useChat } from '@ai-sdk/react';
import type { DirectorCtrl, InterviewPhase } from '@ai-interviewer/shared';
import { extractLastUserText, type InterviewUIMessage } from './messageText';

export interface InterviewDataHandlers {
  onPhase?: (phase: InterviewPhase, askedInPhase: number) => void;
  onDirector?: (ctrl: DirectorCtrl) => void;
  onTts?: (state: 'started' | 'done' | 'aborted' | 'error', turnId: string) => void;
}

export interface UseInterviewChatOptions extends InterviewDataHandlers {
  sessionId: string;
  initialMessages?: InterviewUIMessage[];
}

/** 分发一条 data part 给对应回调，返回是否消费掉了 */
function dispatchData(handlers: InterviewDataHandlers, part: InterviewUIMessage['parts'][number]): void {
  if (part.type === 'data-phase' && 'data' in part) {
    handlers.onPhase?.(part.data.phase, part.data.askedInPhase);
  } else if (part.type === 'data-director' && 'data' in part) {
    handlers.onDirector?.(part.data);
  } else if (part.type === 'data-tts' && 'data' in part) {
    handlers.onTts?.(part.data.state, part.data.turnId);
  }
}

function createHttpTransport(sessionId: string) {
  return new DefaultChatTransport<InterviewUIMessage>({
    api: `/api/interview/${sessionId}/turn`,
    prepareSendMessagesRequest: ({ messages, body }) => ({
      body: {
        text: extractLastUserText(messages),
        source: (body as { source?: 'voice' | 'text' } | undefined)?.source ?? 'text',
      },
    }),
  });
}

/**
 * 开场白：没有用户消息，直接开流。
 * 走 AI SDK 自己的 chunk 解析，不手写 `data:` 行处理。
 */
export async function streamOpening(
  sessionId: string,
  handlers: InterviewDataHandlers,
  signal?: AbortSignal,
): Promise<InterviewUIMessage> {
  const res = await fetch(`/api/interview/${sessionId}/opening`, { method: 'POST', signal });
  if (!res.ok || !res.body) throw new Error(`开场白请求失败：${res.status}`);

  const chunks = parseJsonEventStream({
    stream: res.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!chunk.success) throw chunk.error;
        controller.enqueue(chunk.value);
      },
    }),
  );

  // readUIMessageStream 每来一个 chunk 就给一次「累积到现在的消息」，
  // data part 是追加的，用对象引用去重，避免同一个 director 回调多次
  const dispatched = new WeakSet<object>();
  let last: InterviewUIMessage | undefined;

  for await (const message of readUIMessageStream<InterviewUIMessage>({ stream: chunks })) {
    last = message;
    for (const part of message.parts) {
      if (dispatched.has(part)) continue;
      dispatched.add(part);
      dispatchData(handlers, part);
    }
  }

  if (!last) throw new Error('开场白没有返回内容');
  return last;
}

/** 面试页的 useChat 封装：请求体带 sessionId / source / 文本 */
export function useInterviewChat(options: UseInterviewChatOptions) {
  const { sessionId, onPhase, onDirector, onTts, initialMessages } = options;

  // 回调放进 ref，避免 useChat 因回调变化重建
  const handlers = useRef<InterviewDataHandlers>({ onPhase, onDirector, onTts });
  handlers.current = { onPhase, onDirector, onTts };

  const transport = useMemo(() => createHttpTransport(sessionId), [sessionId]);

  const chat = useChat<InterviewUIMessage>({
    id: sessionId,
    transport,
    ...(initialMessages ? { messages: initialMessages } : {}),
    onData: (part) => dispatchData(handlers.current, part),
  });

  const sendAnswer = useCallback(
    (text: string, source: 'voice' | 'text' = 'text') => {
      const trimmed = text.trim();
      if (trimmed === '') return;
      void chat.sendMessage({ text: trimmed }, { body: { source } });
    },
    [chat],
  );

  return { ...chat, sendAnswer };
}
