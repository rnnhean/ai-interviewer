import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Collapse, Descriptions, Empty, Progress, Result, Space, Spin, Tag, Typography, App } from 'antd';
import type { SessionSnapshot } from '@ai-interviewer/shared';
import { DIMENSION_LABEL } from '@ai-interviewer/shared';
import { apiClient, SessionGoneError } from '../api/client';
import { RadarChart } from '../components/RadarChart';
import { ExportPendingError, downloadExport } from '../export/exporters';

const TRACK_LABEL: Record<string, string> = {
  'agent-engineer': 'Agent 开发工程师',
  'frontend-to-agent': '前端转 Agent',
  'backend-ai': '后端 + AI',
};

const ATMOSPHERE_LABEL: Record<string, string> = {
  gentle: '温和引导',
  standard: '标准',
  pressure: '压力面',
};

export function ReportPage(): React.JSX.Element {
  const { message } = App.useApp();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [lost, setLost] = useState(false);
  const [exporting, setExporting] = useState<'md' | 'json' | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getSession(id)
      .then((s) => {
        if (!cancelled) {
          setSnapshot(s);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof SessionGoneError) setLost(true);
        else message.error('加载报告失败');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleExport = async (format: 'md' | 'json'): Promise<void> => {
    setExporting(format);
    try {
      await downloadExport(id, format);
    } catch (err) {
      if (err instanceof ExportPendingError) message.info('评价报告还在生成，稍后重试');
      else message.error('导出失败，请重试');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: 120 }}>
        <Spin />
      </div>
    );
  }

  if (lost) {
    return (
      <Result
        status="warning"
        title="会话已丢失"
        subTitle="面试记录只保存在服务端内存里，服务重启后就没了。"
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            重新开始面试
          </Button>
        }
      />
    );
  }

  const report = snapshot?.report;

  return (
    <div className="page">
      <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          面试评价
        </Typography.Title>
        <Space>
          <Button loading={exporting === 'md'} onClick={() => void handleExport('md')}>
            导出 Markdown
          </Button>
          <Button loading={exporting === 'json'} onClick={() => void handleExport('json')}>
            导出 JSON
          </Button>
          <Button onClick={() => navigate('/')}>再来一场</Button>
        </Space>
      </Space>

      {snapshot && (
        <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="方向">{TRACK_LABEL[snapshot.track] ?? snapshot.track}</Descriptions.Item>
          <Descriptions.Item label="氛围">{ATMOSPHERE_LABEL[snapshot.atmosphere] ?? snapshot.atmosphere}</Descriptions.Item>
          <Descriptions.Item label="时长">{snapshot.durationMin} 分钟</Descriptions.Item>
        </Descriptions>
      )}

      {!report && (
        <Alert
          type="info"
          showIcon
          title="评价报告尚未生成"
          description="报告正在生成中，或者这次面试没有正常结束。可以稍后刷新页面；对话记录依然可以导出。"
          style={{ marginBottom: 16 }}
        />
      )}

      {report && (
        <>
          <div className="side-card report-section">
            <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div className="total-score" data-testid="total-score">
                  {report.total}
                </div>
                <div style={{ color: '#8a919f', fontSize: 13 }}>总分 / 100</div>
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <RadarChart dimensions={report.dimensions} />
              </div>
            </div>
          </div>

          <div className="side-card report-section">
            <Typography.Title level={4}>五维评分</Typography.Title>
            {report.dimensions.map((d) => (
              <div key={d.key} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span>{DIMENSION_LABEL[d.key]}</span>
                  <span style={{ color: '#8a919f' }}>{d.score} / 10</span>
                </div>
                <Progress percent={d.score * 10} showInfo={false} size="small" />
                <div style={{ fontSize: 13, color: '#495057' }}>{d.comment}</div>
              </div>
            ))}
          </div>

          <div className="side-card report-section">
            <Typography.Title level={4}>好的地方</Typography.Title>
            {report.strengths.map((s, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <blockquote className="quote">“{s.quote}”</blockquote>
                <div style={{ fontSize: 14 }}>{s.why}</div>
              </div>
            ))}
          </div>

          <div className="side-card report-section">
            <Typography.Title level={4}>不足</Typography.Title>
            {report.gaps.map((g, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <blockquote className="quote">“{g.quote}”</blockquote>
                <div style={{ fontSize: 14 }}>
                  <Tag color="orange">问题</Tag>
                  {g.issue}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  <Tag color="blue">改进</Tag>
                  {g.suggestion}
                </div>
              </div>
            ))}
          </div>

          <div className="side-card report-section">
            <Typography.Title level={4}>需要提高的地方</Typography.Title>
            {report.actions.map((a, i) => (
              <div key={i} className="action-item" data-testid="action-item">
                <input type="checkbox" aria-label={`行动 ${i + 1}`} />
                <span>{a}</span>
              </div>
            ))}
          </div>

          {report.fallback && (
            <Alert
              type="warning"
              showIcon
              title="这份报告是降级生成的"
              description="模型这次没能给出结构化评价，分数与建议是按对话内容兜底拼的，参考价值有限。"
            />
          )}
        </>
      )}

      {snapshot && snapshot.rounds.length > 0 && (
        <div className="side-card report-section">
          <Typography.Title level={4}>逐题回看</Typography.Title>
          <Collapse
            items={snapshot.rounds.map((r) => ({
              key: String(r.index),
              label: `第 ${r.index} 题：${r.question.slice(0, 40)}${r.question.length > 40 ? '…' : ''}`,
              children: (
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>面试官：</strong>
                    {r.question}
                  </div>
                  <div>
                    <strong>你的回答：</strong>
                    {r.answer}
                    {r.interrupted && <Tag style={{ marginLeft: 8 }}>被打断</Tag>}
                  </div>
                </div>
              ),
            }))}
          />
        </div>
      )}

      {!report && !snapshot?.rounds.length && <Empty description="没有可回看的对话" />}
    </div>
  );
}
