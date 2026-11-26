import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App as AntApp } from 'antd';
import { InterviewPage } from './InterviewPage';
import { apiClient, SessionGoneError } from '../api/client';
import { useInterviewStore } from '../store/interviewStore';

const SNAPSHOT = {
  id: 's-1',
  track: 'frontend-to-agent' as const,
  atmosphere: 'standard' as const,
  durationMin: 25 as const,
  phase: 'intro' as const,
  askedTotal: 1,
  askedInPhase: 1,
  followUps: 0,
  startedAt: 0,
  status: 'active' as const,
  rounds: [],
};

function renderPage(): void {
  render(
    <AntApp>
      <MemoryRouter initialEntries={['/interview/s-1']}>
        <Routes>
          <Route path="/interview/:id" element={<InterviewPage skipOpening />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

describe('InterviewPage', () => {
  beforeEach(() => {
    useInterviewStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('载入成功时渲染对话区与阶段进度', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(SNAPSHOT);
    renderPage();
    expect(await screen.findByTestId('transcript')).toBeInTheDocument();
    expect(screen.getByTestId('phase-badge')).toHaveTextContent('开场');
    expect(screen.getByTestId('live-caption')).toHaveTextContent(/点麦克风开始说话/);
  });

  it('会话 404 时显示「会话已丢失」而不是白屏', async () => {
    vi.spyOn(apiClient, 'getSession').mockRejectedValue(new SessionGoneError());
    renderPage();
    expect(await screen.findByText('会话已丢失')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /返回开始页/ })).toBeInTheDocument();
  });

  it('其他错误显示后端不可用提示', async () => {
    vi.spyOn(apiClient, 'getSession').mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByText(/加载面试失败/)).toBeInTheDocument();
  });

  it('文字回答为空时不发送', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(SNAPSHOT);
    renderPage();
    await screen.findByTestId('transcript');
    // 输入为空时发送按钮禁用
    expect(screen.getByRole('button', { name: /^发\s*送$/ })).toBeDisabled();
  });
});
