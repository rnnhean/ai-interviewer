import { useEffect, useRef } from 'react';
import { messageText, type InterviewUIMessage } from '../features/chat/messageText';

export interface TranscriptListProps {
  messages: InterviewUIMessage[];
  /** 被打断的助手消息 id，气泡上打标 */
  interruptedIds?: Set<string>;
  /** 正在流式生成的消息 id，用来显示光标 */
  streamingId?: string | null;
}

function roleLabel(m: InterviewUIMessage): string {
  return m.role === 'user' ? '你' : '面试官';
}

/** 对话记录。自动滚到底部 */
export function TranscriptList({ messages, interruptedIds, streamingId }: TranscriptListProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom 里没有 scrollIntoView，测试环境直接跳过
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  return (
    <div className="transcript" data-testid="transcript">
      {messages.map((m) => {
        const text = messageText(m);
        if (text === '') return null;
        const interrupted = interruptedIds?.has(m.id) ?? false;
        return (
          <div
            key={m.id}
            className={`bubble bubble--${m.role === 'user' ? 'user' : 'assistant'}`}
            data-testid={`bubble-${m.role}`}
          >
            <div className="bubble__meta">
              {roleLabel(m)}
              {interrupted && <span className="bubble__tag">被打断</span>}
            </div>
            {text}
            {streamingId === m.id && <span aria-hidden>▍</span>}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
