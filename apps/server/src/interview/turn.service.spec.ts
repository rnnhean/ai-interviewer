import { convertReadableStreamToArray } from 'ai/test';
import type { LanguageModel } from 'ai';
import { describe, expect, it } from 'vitest';
import { modelSaying } from '../testing/mock-model';
import { InterviewService, SessionStore } from './session.store';
import { createOpeningStream, createTurnStream, type TtsSink, type TurnChunk } from './turn.service';

function makeTts() {
  const calls: Array<{ kind: string; turnId: string; text?: string }> = [];
  const sink: TtsSink = {
    speak: (_s, turnId, text) => calls.push({ kind: 'speak', turnId, text }),
    finishTurn: (_s, turnId) => calls.push({ kind: 'finish', turnId }),
    abortTurn: (_s, turnId) => calls.push({ kind: 'abort', turnId }),
  };
  return { sink, calls };
}

function setup(model: LanguageModel) {
  const interviews = new InterviewService(new SessionStore());
  const s = interviews.create({ track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 }, 's1');
  const { sink, calls } = makeTts();
  return { interviews, s, deps: { model, interviews, tts: sink }, calls };
}

async function collect(stream: ReadableStream<TurnChunk>): Promise<TurnChunk[]> {
  return (await convertReadableStreamToArray(stream as ReadableStream<unknown>)) as TurnChunk[];
}

function textOf(chunks: TurnChunk[]): string {
  return chunks
    .filter((c): c is Extract<TurnChunk, { type: 'text-delta' }> => c.type === 'text-delta')
    .map((c) => c.delta)
    .join('');
}

const CTRL = '<<CTRL {"move":"follow_up","phase":"project","asked":3}>>\n\n';

describe('createTurnStream', () => {
  it('控制行先于正文：data-director / data-phase 出现在第一个 text-delta 之前', async () => {
    const { deps, s } = setup(modelSaying(CTRL + '先说你测过哪些边界。'));
    Object.assign(s, { phase: 'project', askedInPhase: 3, currentQuestion: '上一问' });

    const chunks = await collect(createTurnStream(deps, { sessionId: s.id, text: '我做过 RAG' }));

    const dirIdx = chunks.findIndex((c) => c.type === 'data-director');
    const phaseIdx = chunks.findIndex((c) => c.type === 'data-phase');
    const firstDelta = chunks.findIndex((c) => c.type === 'text-delta');

    expect(dirIdx).toBeGreaterThanOrEqual(0);
    expect(phaseIdx).toBeGreaterThanOrEqual(0);
    expect(firstDelta).toBeGreaterThanOrEqual(0);
    expect(dirIdx).toBeLessThan(firstDelta);
    expect(phaseIdx).toBeLessThan(firstDelta);
  });

  it('正文不含控制行', async () => {
    const { deps, s } = setup(modelSaying(CTRL + '先说你测过哪些边界。'));
    s.phase = 'project';
    const chunks = await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));
    const text = textOf(chunks);
    expect(text).not.toContain('<<CTRL');
    expect(text).not.toContain('>>');
    expect(text).toBe('先说你测过哪些边界。');
  });

  it('候选人的回答与上一问一起落成一条轮次', async () => {
    const { deps, s, interviews } = setup(modelSaying(CTRL + '继续说说。'));
    Object.assign(s, { phase: 'project', currentQuestion: 'RAG 的召回怎么做？' });
    await collect(createTurnStream(deps, { sessionId: s.id, text: '先粗召回再 rerank', source: 'voice' }));

    const rounds = interviews.require(s.id).rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.question).toBe('RAG 的召回怎么做？');
    expect(rounds[0]!.answer).toBe('先粗召回再 rerank');
    expect(rounds[0]!.source).toBe('voice');
  });

  it('面试官的新发言会成为下一轮的 currentQuestion', async () => {
    const { deps, s, interviews } = setup(modelSaying(CTRL + '那 rerank 你用的什么模型？'));
    Object.assign(s, { phase: 'project', currentQuestion: 'RAG 的召回怎么做？' });
    await collect(createTurnStream(deps, { sessionId: s.id, text: '先粗召回' }));
    expect(interviews.require(s.id).currentQuestion).toBe('那 rerank 你用的什么模型？');
  });

  it('模型不输出控制行时用兜底决策并记一次违规', async () => {
    const { deps, s, interviews } = setup(modelSaying('直接开始问：你做过什么？'));
    Object.assign(s, { phase: 'project', askedInPhase: 1 });
    const chunks = await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));

    const dir = chunks.find((c) => c.type === 'data-director');
    expect(dir).toMatchObject({ data: { move: 'advance', phase: 'project', asked: 2 } });
    expect(interviews.require(s.id).formatViolations).toBe(1);
  });

  it('追问决策把 followUps 加一', async () => {
    const { deps, s, interviews } = setup(modelSaying(CTRL + '继续。'));
    Object.assign(s, { phase: 'project', askedInPhase: 3 });
    await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));
    expect(interviews.require(s.id).followUps).toBe(1);
  });

  it('推进决策更新阶段与已问题数', async () => {
    const ctrlAdvance = '<<CTRL {"move":"advance","phase":"project","asked":4}>>\n\n';
    const { deps, s, interviews } = setup(modelSaying(ctrlAdvance + '下一题。'));
    Object.assign(s, { phase: 'project', askedInPhase: 3 });
    await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));
    expect(interviews.require(s.id).askedInPhase).toBe(4);
  });

  it('TTS 收到的是可朗读文本，不含代码围栏', async () => {
    const body = '```ts\nconst a = 1;\n```\n这段代码有问题吗？';
    const { deps, s, calls } = setup(modelSaying(CTRL + body));
    s.phase = 'project';
    await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));

    const spoken = calls.filter((c) => c.kind === 'speak').map((c) => c.text ?? '').join('');
    expect(spoken).not.toContain('const a');
    expect(spoken).not.toContain('```');
  });

  it('TTS finishTurn 被调用一次、不 abort', async () => {
    const { deps, s, calls } = setup(modelSaying(CTRL + '好的。'));
    s.phase = 'project';
    await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));
    expect(calls.filter((c) => c.kind === 'finish')).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'abort')).toHaveLength(0);
  });

  it('会话不存在时流里出现 error chunk', async () => {
    const { deps } = setup(modelSaying('x'));
    const chunks = await collect(createTurnStream(deps, { sessionId: 'nope', text: 'x' }));
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });

  it('已结束的会话不能再生成', async () => {
    const { deps, s } = setup(modelSaying('x'));
    deps.interviews.markFinished(s.id);
    const chunks = await collect(createTurnStream(deps, { sessionId: s.id, text: 'x' }));
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});

describe('createOpeningStream', () => {
  const OPEN = '<<CTRL {"move":"advance","phase":"intro","asked":1}>>\n\n你好，我是今天的面试官。先简单介绍一下你自己。';

  it('开场不产生轮次，只设置当前问题', async () => {
    const { deps, s, interviews } = setup(modelSaying(OPEN));
    await collect(createOpeningStream(deps, s.id));

    const after = interviews.require(s.id);
    expect(after.rounds).toHaveLength(0);
    expect(after.currentQuestion).toContain('先简单介绍一下你自己');
    expect(after.phase).toBe('intro');
    expect(after.askedInPhase).toBe(1);
    expect(after.askedTotal).toBe(1);
  });

  it('开场正文不含控制行', async () => {
    const { deps, s } = setup(modelSaying(OPEN));
    const chunks = await collect(createOpeningStream(deps, s.id));
    expect(textOf(chunks)).not.toContain('<<CTRL');
  });
});
