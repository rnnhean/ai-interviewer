import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InterviewerAvatar } from './InterviewerAvatar';

describe('InterviewerAvatar', () => {
  it('待命时不显示音量条，状态文案是待命', () => {
    render(<InterviewerAvatar speaking={false} />);
    expect(screen.getByTestId('interviewer-avatar').textContent).toContain('待命');
    expect(screen.queryByTestId('interviewer-meter')).toBeNull();
  });

  it('说话时出现音量条', () => {
    render(<InterviewerAvatar speaking level={0.6} />);
    expect(screen.getByTestId('interviewer-meter')).toBeTruthy();
    expect(screen.getByTestId('interviewer-meter').children).toHaveLength(5);
  });

  it('头像里渲染出真正的插画头像，不是空白', () => {
    render(<InterviewerAvatar speaking={false} />);
    const svg = screen.getByTestId('interviewer-face').querySelector('svg');
    expect(svg).toBeTruthy();
    // 有实际图形内容，而不是只有一层背景色
    expect(screen.getByTestId('interviewer-face').querySelectorAll('path').length).toBeGreaterThan(3);
    expect(screen.getByTestId('interviewer-face').textContent).not.toContain('metadata');
  });

  it('音量越大音量条越高', () => {
    const { rerender } = render(<InterviewerAvatar speaking level={0} />);
    const heights = (): number[] =>
      Array.from(screen.getByTestId('interviewer-meter').children).map((el) =>
        Number.parseFloat((el as HTMLElement).style.height),
      );

    const quiet = heights();
    rerender(<InterviewerAvatar speaking level={1} />);
    const loud = heights();

    loud.forEach((h, i) => expect(h).toBeGreaterThan(quiet[i]!));
  });

  it('音量超出 0–1 也不会画出异常尺寸', () => {
    render(<InterviewerAvatar speaking level={9} />);
    const heights = Array.from(screen.getByTestId('interviewer-meter').children).map((el) =>
      Number.parseFloat((el as HTMLElement).style.height),
    );
    heights.forEach((h) => {
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeLessThanOrEqual(26);
    });
  });

  it('同页放多个头像时，svg 内部 id 不会互相覆盖', () => {
    render(
      <>
        <InterviewerAvatar speaking={false} />
        <InterviewerAvatar speaking={false} />
      </>,
    );
    // DiceBear 每个实例都写死 id="viewboxMask"，不加前缀第二个会被裁成空白
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('label 优先于默认状态文案', () => {
    render(<InterviewerAvatar speaking label="正在说话（可以直接开口打断）" />);
    expect(screen.getByTestId('interviewer-avatar').textContent).toContain('可以直接开口打断');
  });
});