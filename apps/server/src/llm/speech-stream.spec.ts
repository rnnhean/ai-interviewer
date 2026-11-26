import { describe, expect, it } from 'vitest';
import { SpeechStreamer } from './speech-stream';

function run(deltas: string[]): string[] {
  const out: string[] = [];
  const s = new SpeechStreamer((t) => out.push(t));
  for (const d of deltas) s.push(d);
  s.flush();
  return out;
}

describe('SpeechStreamer', () => {
  it('按句送出，尾巴留到 flush', () => {
    const out = run(['先说你测过哪些边界。', '再讲讲你怎么', '定位问题的']);
    expect(out).toEqual(['先说你测过哪些边界。', '再讲讲你怎么定位问题的']);
  });

  it('一次送入多句会拆开', () => {
    const out = run(['你说得对。那我们换个角度；你还有什么补充？']);
    expect(out).toEqual(['你说得对。', '那我们换个角度；', '你还有什么补充？']);
  });

  it('围栏里的代码不朗读', () => {
    const out = run(['```ts\nconst a = 1;\n```\n这段代码有问题吗？']);
    expect(out.join('')).not.toContain('const a');
    expect(out.join('')).not.toContain('```');
    expect(out.join('')).toBe('这段代码有问题吗？');
  });

  it('围栏被切在 chunk 边界上也不会泄漏', () => {
    const out = run(['``', '`ts\nconst a = 1;', '\n``', '`\n这段代码有问题吗？']);
    const spoken = out.join('');
    expect(spoken).not.toContain('const a');
    expect(spoken).not.toContain('`');
    expect(spoken).toBe('这段代码有问题吗？');
  });

  it('逐字符送入也不泄漏围栏内容', () => {
    const text = '这是一句。\n```js\nconst x = 42;\n```\n后面还有。';
    const out = run([...text]);
    expect(out).toEqual(['这是一句。', '后面还有。']);
  });

  it('行内反引号保留内容、去掉反引号', () => {
    const out = run(['你说的 `rerank` 是什么意思？']);
    expect(out).toEqual(['你说的 rerank 是什么意思？']);
  });

  it('没有句末标点时只在 flush 送出一次', () => {
    const out = run(['你说说看']);
    expect(out).toEqual(['你说说看']);
  });

  it('全是代码时不产生任何朗读文本', () => {
    const out = run(['```py\nprint(1)\n```']);
    expect(out).toEqual([]);
  });
});