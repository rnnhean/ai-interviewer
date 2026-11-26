import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from './SetupPage';
import { apiClient } from '../api/client';
import { useInterviewStore } from '../store/interviewStore';

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <SetupPage />
    </MemoryRouter>,
  );
}

describe('SetupPage', () => {
  beforeEach(() => {
    useInterviewStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('默认选中「前端转 Agent」「标准」「25 分钟」', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: /前端转 Agent/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^标准/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /25 分钟/ })).toBeChecked();
  });

  it('三档氛围各自有一句话说明', () => {
    renderPage();
    expect(screen.getByText(/追问最多 1 层/)).toBeInTheDocument();
    expect(screen.getByText(/最多 2 层追问/)).toBeInTheDocument();
    expect(screen.getByText(/追问 2–3 层/)).toBeInTheDocument();
  });

  it('点击开始调用 createSession 并带上三项选择', async () => {
    const spy = vi.spyOn(apiClient, 'createSession').mockResolvedValue({
      id: 's-1',
      snapshot: {
        id: 's-1',
        track: 'frontend-to-agent',
        atmosphere: 'pressure',
        durationMin: 25,
        phase: 'intro',
        askedTotal: 0,
        askedInPhase: 0,
        followUps: 0,
        startedAt: 0,
        status: 'active',
        rounds: [],
      },
    });

    renderPage();
    await userEvent.click(screen.getByRole('radio', { name: /压力面/ }));
    await userEvent.click(screen.getByRole('button', { name: /开始面试/ }));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ atmosphere: 'pressure' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ track: 'frontend-to-agent', durationMin: 25 }));
  });

  it('创建失败时提示后重试，不跳页', async () => {
    vi.spyOn(apiClient, 'createSession').mockRejectedValue(new Error('boom'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /开始面试/ }));
    expect(await screen.findByText(/创建面试失败/)).toBeInTheDocument();
  });
});
