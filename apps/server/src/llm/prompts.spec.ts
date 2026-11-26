import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, speechOnly } from './prompts';
import type { SessionSnapshot } from '@ai-interviewer/shared';

const snap = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: 's1',
  track: 'frontend-to-agent',
  atmosphere: 'standard',
  durationMin: 25,
  phase: 'project',
  askedTotal: 3,
  askedInPhase: 2,
  followUps: 1,
  startedAt: 0,
  status: 'active',
  rounds: [],
  ...over,
});

describe('buildSystemPrompt', () => {
  it('包含阶段、题量与口播约束', () => {
    const p = buildSystemPrompt({ snapshot: snap() });
    expect(p).toContain('project');
    expect(p).toContain('2–4 句');
    expect(p).toContain('<<CTRL ');
  });

  it('标准档追问上限 2 层', () => {
    expect(buildSystemPrompt({ snapshot: snap({ atmosphere: 'standard' }) })).toContain('最多 2 层追问');
  });

  it('压力面强调 60 秒与量化', () => {
    const p = buildSystemPrompt({ snapshot: snap({ atmosphere: 'pressure' }) });
    expect(p).toContain('60 秒');
    expect(p).toContain('必须给数字');
  });

  it('温和引导给提示、不打断', () => {
    const p = buildSystemPrompt({ snapshot: snap({ atmosphere: 'gentle' }) });
    expect(p).toContain('给一个提示');
    expect(p).not.toContain('直接质疑你是不是没做过');
  });

  it('评审题的代码只进展示，不进口播要求', () => {
    const p = buildSystemPrompt({
      snapshot: snap({ phase: 'scenario' }),
      question: {
        id: 'q',
        dimension: 'verification',
        phase: 'scenario',
        displayText: '```ts\nconst x = 1;\n```',
        speechText: '看看这段代码。',
      },
    });
    expect(p).toContain('不要朗读代码');
    expect(p).toContain('看看这段代码。');
  });

  it('简历文本会带上', () => {
    const p = buildSystemPrompt({ snapshot: snap({ resumeText: '三年半前端，做过知识库' }) });
    expect(p).toContain('三年半前端，做过知识库');
  });

  it('已问轮次会带上，供模型避免重复', () => {
    const p = buildSystemPrompt({
      snapshot: snap({
        rounds: [
          { index: 1, question: '自我介绍', answer: '我做了三年前端', source: 'voice', submittedAt: 0, interrupted: false },
        ],
      }),
    });
    expect(p).toContain('自我介绍');
  });
});

describe('speechOnly', () => {
  it('剥掉围栏代码块', () => {
    expect(speechOnly('先看：\n```ts\nconst a=1\n```\n再说。').replace(/\s+/g, '')).toBe('先看：再说。');
  });

  it('剥掉行内反引号', () => {
    expect(speechOnly('用 `useChat` 收流')).toBe('用 useChat 收流');
  });

  it('没代码时基本原样', () => {
    expect(speechOnly('先给结论。再讲原因。')).toBe('先给结论。再讲原因。');
  });
});
