import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App as AntApp } from 'antd';
import { ReportPage } from './ReportPage';
import { apiClient } from '../api/client';
import * as exporters from '../export/exporters';

const REPORT = {
  total: 78,
  dimensions: [
    { key: 'technical' as const, score: 7, comment: '讲到 RAG 时能说清检索与重排的分工' },
    { key: 'decomposition' as const, score: 8, comment: '把问题拆成检索、生成、评测三段' },
    { key: 'tradeoff' as const, score: 6, comment: '没比较向量库与关键词检索的取舍' },
    { key: 'verification' as const, score: 7, comment: '提到用过评测集，但没说指标' },
    { key: 'communication' as const, score: 8, comment: '先给结论再补细节，结构清楚' },
  ],
  strengths: [
    { quote: '我先说结论', why: '开头就给结论，面试官能立刻抓到重点' },
    { quote: '我们做过 A/B', why: '用对比数据支撑判断' },
    { quote: '这块我踩过坑', why: '有真实经验，不是背答案' },
  ],
  gaps: [
    { quote: '大概快一些', issue: '缺具体数字', suggestion: '给 p95 延迟与吞吐量级' },
    { quote: '都能用', issue: '没有取舍', suggestion: '说出两套方案各自代价' },
    { quote: '没测过', issue: '缺验证意识', suggestion: '至少讲一条你能想到的验证办法' },
  ],
  actions: ['补一套 RAG 评测集，标 20 条并算命中率', '准备三个项目的性能数字', '练习 90 秒讲完一个项目'],
};

const SNAPSHOT = {
  id: 's-1',
  track: 'frontend-to-agent' as const,
  atmosphere: 'standard' as const,
  durationMin: 25 as const,
  phase: 'done' as const,
  askedTotal: 3,
  askedInPhase: 1,
  followUps: 0,
  startedAt: 0,
  status: 'finished' as const,
  rounds: [],
  report: REPORT,
};

function renderPage(): void {
  render(
    <AntApp>
      <MemoryRouter initialEntries={['/report/s-1']}>
        <Routes>
          <Route path="/report/:id" element={<ReportPage />} />
        </Routes>
      </MemoryRouter>
    </AntApp>,
  );
}

describe('ReportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染五维雷达与三条建议', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(SNAPSHOT);
    renderPage();
    expect(await screen.findByTestId('radar')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('action-item')).toHaveLength(3));
    expect(screen.getByTestId('total-score')).toHaveTextContent('78');
  });

  it('报告未生成时显示提示而不是白屏', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue({ ...SNAPSHOT, report: undefined });
    renderPage();
    expect(await screen.findByText('评价报告尚未生成')).toBeInTheDocument();
  });

  it('点导出触发 md 下载', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(SNAPSHOT);
    const spy = vi.spyOn(exporters, 'downloadExport').mockResolvedValue();
    renderPage();
    await screen.findByTestId('radar');
    await userEvent.click(screen.getByRole('button', { name: /导出 Markdown/ }));
    expect(spy).toHaveBeenCalledWith('s-1', 'md');
  });
});
