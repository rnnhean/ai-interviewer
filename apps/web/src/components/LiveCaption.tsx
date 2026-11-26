export interface LiveCaptionProps {
  /** ASR 的 partial（灰字） */
  partial: string;
  /** 已确认、等待提交的整轮文本 */
  draft: string;
  /** 麦克风是否开着 */
  listening: boolean;
}

/** 实时字幕：已确认部分为正文色，partial 为灰字 */
export function LiveCaption({ partial, draft, listening }: LiveCaptionProps): React.JSX.Element {
  const hasText = draft !== '' || partial !== '';
  const placeholder = listening ? '正在听，请说话…' : '点麦克风开始说话，或者直接用文字输入';

  return (
    <div className={`caption-box${hasText ? ' caption-box--live' : ''}`} data-testid="live-caption">
      {draft && <span>{draft}</span>}
      {draft && partial && ' '}
      {partial && <span className="caption-partial">{partial}</span>}
      {!hasText && placeholder}
    </div>
  );
}
