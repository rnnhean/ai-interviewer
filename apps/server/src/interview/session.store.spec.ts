import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { InterviewService, SessionStore } from './session.store';

function makeService() {
  return new InterviewService(new SessionStore());
}

const input = { track: 'agent-engineer', atmosphere: 'standard', durationMin: 15 } as const;

describe('InterviewService', () => {
  it('新建会话的初始状态', () => {
    const s = makeService().create(input, 's1');
    expect(s.phase).toBe('intro');
    expect(s.status).toBe('active');
    expect(s.rounds).toEqual([]);
    expect(s.currentQuestion).toBe('');
    expect(s.pendingAnswer).toBe('');
  });

  it('会话不存在时 require 抛 NotFoundException', () => {
    expect(() => makeService().require('nope')).toThrow(NotFoundException);
  });

  it('结束后不能继续作答', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.markFinished(s.id);
    expect(() => svc.assertActive(s.id)).toThrow(BadRequestException);
  });

  it('commitRound 把当前问题与回答写成一条轮次', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.setCurrentQuestion(s.id, '你是怎么设计召回链路的？');
    svc.appendAnswer(s.id, '先做粗召回再做 rerank');
    const r = svc.commitRound(s.id, { answer: svc.require(s.id).pendingAnswer, source: 'voice', interrupted: false });

    expect(r).not.toBeNull();
    expect(r!.question).toBe('你是怎么设计召回链路的？');
    expect(r!.answer).toBe('先做粗召回再做 rerank');
    expect(r!.index).toBe(1);
    expect(svc.require(s.id).pendingAnswer).toBe('');
  });

  it('空回答不记录轮次', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.setCurrentQuestion(s.id, '问题');
    svc.commitRound(s.id, { answer: '   ', source: 'voice', interrupted: false });
    expect(svc.require(s.id).rounds).toHaveLength(0);
  });

  it('打断时保留半句话并标记 interrupted', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.setCurrentQuestion(s.id, '第一个问题');
    svc.appendAnswer(s.id, '我说到这里就被打断了');
    expect(svc.interrupt(s.id)).toBe(true);

    const r = svc.require(s.id).rounds[0]!;
    expect(r.answer).toBe('我说到这里就被打断了');
    expect(r.question).toBe('第一个问题');
    expect(r.interrupted).toBe(true);
  });

  it('打断会 abort 正在生成的回复', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    const ctrl = new AbortController();
    svc.setTurnController(s.id, ctrl);
    svc.interrupt(s.id);
    expect(ctrl.signal.aborted).toBe(true);
    expect(svc.require(s.id).turnController).toBeUndefined();
  });

  it('重复 interrupt 不产生第二条轮次', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.setCurrentQuestion(s.id, '问题');
    svc.appendAnswer(s.id, '半句');
    svc.interrupt(s.id);
    expect(svc.interrupt(s.id)).toBe(false);
    expect(svc.require(s.id).rounds).toHaveLength(1);
  });

  it('applyDirector 追问时只增加 followUps', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    Object.assign(svc.require(s.id), { phase: 'project', askedInPhase: 2, askedTotal: 3 });
    svc.applyDirector(s.id, { move: 'follow_up', phase: 'project', asked: 2 });
    const after = svc.require(s.id);
    expect(after.followUps).toBe(1);
    expect(after.phase).toBe('project');
    expect(after.askedTotal).toBe(3);
  });

  it('applyDirector 同阶段推进：askedTotal +1', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.require(s.id).phase = 'project';
    svc.applyDirector(s.id, { move: 'advance', phase: 'project', asked: 3 });
    expect(svc.require(s.id).askedInPhase).toBe(3);
    expect(svc.require(s.id).askedTotal).toBe(1);
  });

  it('applyDirector 换阶段：followUps 归零、askedInPhase 归 1', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    Object.assign(svc.require(s.id), { phase: 'project', followUps: 2 });
    svc.applyDirector(s.id, { move: 'advance', phase: 'fundamentals', asked: 1 });
    const after = svc.require(s.id);
    expect(after.phase).toBe('fundamentals');
    expect(after.followUps).toBe(0);
    expect(after.askedInPhase).toBe(1);
  });

  it('applyDirector close 进入 done', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    svc.applyDirector(s.id, { move: 'close', phase: 'done', asked: 1 });
    expect(svc.require(s.id).phase).toBe('done');
  });

  it('追问超过氛围上限时强制进入下一阶段，不会卡死', () => {
    const svc = makeService();
    const s = svc.create(input, 's1'); // standard：最多 2 层追问
    Object.assign(svc.require(s.id), { phase: 'project', askedInPhase: 2, askedTotal: 3 });

    svc.applyDirector(s.id, { move: 'follow_up', phase: 'project', asked: 2 });
    expect(svc.require(s.id).phase).toBe('project');
    expect(svc.require(s.id).followUps).toBe(1);
    expect(svc.require(s.id).askedInPhase).toBe(2);

    svc.applyDirector(s.id, { move: 'follow_up', phase: 'project', asked: 2 });
    const after = svc.require(s.id);
    expect(after.phase).toBe('fundamentals');
    expect(after.followUps).toBe(0);
    expect(after.askedInPhase).toBe(1);
  });

  it('模型连续追问也不会停在开场阶段', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    Object.assign(svc.require(s.id), { askedTotal: 1, askedInPhase: 1 });

    for (let i = 0; i < 10; i += 1) {
      svc.applyDirector(s.id, { move: 'follow_up', phase: 'intro', asked: 1 });
    }
    expect(svc.require(s.id).phase).not.toBe('intro');
  });

  it('snapshot 不暴露内部字段', () => {
    const svc = makeService();
    const s = svc.create(input, 's1');
    const snap = svc.snapshot(s.id);
    expect(Object.keys(snap)).not.toContain('pendingAnswer');
    expect(Object.keys(snap)).not.toContain('formatViolations');
    expect(Object.keys(snap)).not.toContain('usedQuestionIds');
    expect(Object.keys(snap)).not.toContain('turnController');
  });
});
