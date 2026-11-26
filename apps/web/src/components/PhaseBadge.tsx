import type { InterviewPhase } from '@ai-interviewer/shared';

const LABEL: Record<InterviewPhase, string> = {
  intro: '开场',
  project: '项目深挖',
  fundamentals: '原理',
  scenario: '场景设计',
  reverse: '反问',
  done: '结束',
};

const ORDER: InterviewPhase[] = ['intro', 'project', 'fundamentals', 'scenario', 'reverse'];

export interface PhaseBadgeProps {
  phase: InterviewPhase;
  askedInPhase: number;
}

/** 阶段进度：当前阶段高亮，显示本阶段第几题 */
export function PhaseBadge({ phase, askedInPhase }: PhaseBadgeProps): React.JSX.Element {
  const done = new Set<InterviewPhase>();
  const idx = ORDER.indexOf(phase);
  if (idx > 0) for (let i = 0; i < idx; i += 1) done.add(ORDER[i]!);

  return (
    <div data-testid="phase-badge">
      <div style={{ fontSize: 14, marginBottom: 8 }}>
        <strong>{LABEL[phase]}</strong>
        {phase !== 'done' && <span style={{ color: '#8a919f' }}> 第 {askedInPhase} 题</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ORDER.map((p) => {
          const state = p === phase ? 'current' : done.has(p) ? 'done' : 'todo';
          return (
            <span
              key={p}
              data-state={state}
              style={{
                fontSize: 12,
                padding: '2px 8px',
                borderRadius: 999,
                background: state === 'current' ? '#e7edff' : state === 'done' ? '#f1f3f7' : '#fafbfc',
                color: state === 'current' ? '#3b5bdb' : state === 'done' ? '#495057' : '#adb5bd',
                border: '1px solid #e6e8ec',
              }}
            >
              {LABEL[p]}
            </span>
          );
        })}
      </div>
    </div>
  );
}
