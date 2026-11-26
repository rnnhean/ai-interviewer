import { describe, expect, it } from 'vitest';
import { DirectorStreamParser } from './director-parser';

const line = '<<CTRL {"move":"follow_up","phase":"project","asked":3}>>\n\n';

describe('DirectorStreamParser', () => {
  it('整块输入时剥离控制行', () => {
    const p = new DirectorStreamParser();
    expect(p.push(line + '先说你测过哪些边界。')).toEqual({
      ctrl: { move: 'follow_up', phase: 'project', asked: 3 },
      text: '先说你测过哪些边界。',
    });
  });

  it('控制行被拆在多个 chunk 里也不外泄', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {"move":"adv')).toEqual({ text: '' });
    // 控制行一解析出来就立刻上抛，不等正文
    expect(p.push('ance","phase":"project","asked":4}>>\n')).toEqual({
      ctrl: { move: 'advance', phase: 'project', asked: 4 },
      text: '',
    });
    expect(p.push('\n好的。')).toEqual({ text: '好的。' });
  });

  it('没有控制行时原样透传并标记违规', () => {
    const p = new DirectorStreamParser();
    expect(p.push('直接开始问：')).toEqual({ text: '直接开始问：' });
    expect(p.violated).toBe(true);
  });

  it('控制行 JSON 坏掉时丢弃该行，正文照常', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {oops}>>\n正文')).toEqual({ text: '正文' });
    expect(p.violated).toBe(true);
    expect(p.push('继续').text).toBe('继续');
  });

  it('CRLF 换行同样识别', () => {
    const p = new DirectorStreamParser();
    expect(p.push(line.replace(/\n/g, '\r\n') + '末')).toEqual({
      ctrl: { move: 'follow_up', phase: 'project', asked: 3 },
      text: '末',
    });
  });

  it('前导空行后跟控制行仍能识别', () => {
    const p = new DirectorStreamParser();
    expect(p.push('\n\n' + line + '正文')).toEqual({
      ctrl: { move: 'follow_up', phase: 'project', asked: 3 },
      text: '正文',
    });
  });

  it('非法 move 值视为违规但控制行仍被消耗', () => {
    const p = new DirectorStreamParser();
    const r = p.push('<<CTRL {"move":"jump","phase":"project","asked":3}>>\n正文');
    expect(r.text).toBe('正文');
    expect(r.ctrl).toBeUndefined();
    expect(p.violated).toBe(true);
  });

  it('控制行之后的内容全部直通，不再检查', () => {
    const p = new DirectorStreamParser();
    p.push(line + 'a');
    expect(p.push('<<CTRL {}>>')).toEqual({ text: '<<CTRL {}>>' });
  });

  it('flush 返回未吐出的剩余', () => {
    const p = new DirectorStreamParser();
    p.push('没有控制行');
    expect(p.flush()).toEqual({ text: '' });
  });

  // 真实模型会把结尾写成单个 `>`，不能因此丢掉整条控制行
  it('单尖括号结尾同样识别', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {"move":"advance","phase":"intro","asked":1}>\n\n你好，欢迎来')).toEqual({
      ctrl: { move: 'advance', phase: 'intro', asked: 1 },
      text: '你好，欢迎来',
    });
    expect(p.violated).toBe(false);
  });

  it('单尖括号被拆在 chunk 里也识别', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {"move":"advance","phase":"intro",')).toEqual({ text: '' });
    expect(p.push('"asked":1}>\n\n你好')).toEqual({
      ctrl: { move: 'advance', phase: 'intro', asked: 1 },
      text: '你好',
    });
  });

  it('控制行后直接断流（无换行）也能收下', () => {
    const p = new DirectorStreamParser();
    expect(p.push('<<CTRL {"move":"advance","phase":"intro","asked":1}>')).toEqual({
      ctrl: { move: 'advance', phase: 'intro', asked: 1 },
      text: '',
    });
  });

  it('flush 时只差换行的控制行也要收下', () => {
    const p = new DirectorStreamParser();
    p.push('<<CTRL {"move":"advance","phase":"intro",');
    expect(p.flush()).toEqual({ text: '' });
    expect(p.violated).toBe(true);
  });
});
