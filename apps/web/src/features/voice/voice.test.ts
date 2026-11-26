import { describe, expect, it } from 'vitest';
import { frameEnergy, floatToInt16 } from './pcm';
import { createTurnAssembler } from './turn-assembler';

describe('floatToInt16', () => {
  it('Float32 溢出时夹紧到 int16 范围', () => {
    const out = floatToInt16(new Float32Array([1, -1, 0.5, 2, -2]));
    expect(Array.from(out)).toEqual([32767, -32768, 16384, 32767, -32768]);
  });

  it('空帧返回空数组', () => {
    expect(floatToInt16(new Float32Array([])).length).toBe(0);
  });

  it('frameEnergy 对静音返回 0', () => {
    expect(frameEnergy(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it('frameEnergy 对满幅正弦返回约 0.707', () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 2);
    expect(frameEnergy(samples)).toBeGreaterThan(0.6);
    expect(frameEnergy(samples)).toBeLessThan(0.75);
  });
});

describe('turnAssembler', () => {
  it('第一段语音开始计时，并累计多段文本', () => {
    const a = createTurnAssembler();
    expect(a.push({ type: 'segment_final', text: '我做过知识库', at: 0 })).toEqual([]);
    a.push({ type: 'segment_final', text: '主要做前端渲染', at: 9000 });
    expect(a.state().text).toBe('我做过知识库 主要做前端渲染');
    expect(a.state().startedAt).toBe(0);
  });

  it('静音 2.5 秒触发提交', () => {
    const a = createTurnAssembler();
    a.push({ type: 'segment_final', text: '回答', at: 1000 });
    expect(a.push({ type: 'tick', at: 3000 })).toEqual([]);
    expect(a.push({ type: 'tick', at: 3501 })).toEqual([{ type: 'submit', text: '回答', reason: 'silence' }]);
  });

  it('90 秒硬上限提交', () => {
    const a = createTurnAssembler();
    a.push({ type: 'segment_final', text: '很长的一段回答', at: 0 });
    // 中间一直在说话，静音判定不会触发
    for (let t = 5000; t < 90_000; t += 5000) {
      a.push({ type: 'segment_final', text: '继续', at: t });
    }
    expect(a.push({ type: 'tick', at: 90_000 })).toEqual([
      { type: 'submit', text: expect.stringContaining('很长的一段回答') as unknown as string, reason: 'timeout' },
    ]);
  });

  it('空文本不提交', () => {
    const a = createTurnAssembler();
    expect(a.push({ type: 'tick', at: 100_000 })).toEqual([]);
    expect(a.push({ type: 'manual_submit', at: 100_001 })).toEqual([]);
  });

  it('提交后状态归零', () => {
    const a = createTurnAssembler();
    a.push({ type: 'segment_final', text: '回答', at: 0 });
    a.push({ type: 'manual_submit', at: 100 });
    expect(a.state()).toEqual({ text: '', startedAt: null, lastSpeechAt: null });
  });

  it('一句话的静音不会重复提交', () => {
    const a = createTurnAssembler();
    a.push({ type: 'segment_final', text: '回答', at: 1000 });
    expect(a.push({ type: 'tick', at: 4000 })).toHaveLength(1);
    expect(a.push({ type: 'tick', at: 8000 })).toEqual([]);
  });

  it('空白片段不入账', () => {
    const a = createTurnAssembler();
    expect(a.push({ type: 'segment_final', text: '   ', at: 0 })).toEqual([]);
    expect(a.state().text).toBe('');
  });

  it('术语归一替换最后一段，不动前面的内容', () => {
    const a = createTurnAssembler();
    a.push({ type: 'segment_final', text: '我做过知识库', at: 0 });
    a.push({ type: 'segment_final', text: '用 react 写的', at: 1000 });
    a.replaceLast('用 React 写的');
    expect(a.state().text).toBe('我做过知识库 用 React 写的');
  });

  it('归一后文本为空时不改动', () => {
    const a = createTurnAssembler();
    a.push({ type: 'segment_final', text: '回答', at: 0 });
    a.replaceLast('  ');
    expect(a.state().text).toBe('回答');
  });
});
