import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Input, Radio, Space, Typography } from 'antd';
import type { Atmosphere, DurationMin, Track } from '@ai-interviewer/shared';
import { apiClient } from '../api/client';
import { useInterviewStore } from '../store/interviewStore';

const TRACK_OPTIONS: { value: Track; label: string; desc: string }[] = [
  { value: 'frontend-to-agent', label: '前端转 Agent', desc: '重点考察迁移能力：把已有前端经验接到 Agent 工程上' },
  { value: 'agent-engineer', label: 'Agent 开发工程师', desc: '有 Agent 落地经验，考察判断力与真实项目' },
  { value: 'backend-ai', label: '后端 + AI', desc: '重点考察工程化与稳定性：并发、降级、可观测' },
];

const ATMOSPHERE_OPTIONS: { value: Atmosphere; label: string; desc: string }[] = [
  { value: 'gentle', label: '温和引导', desc: '追问最多 1 层，答不上来给提示，不打断' },
  { value: 'standard', label: '标准', desc: '最多 2 层追问，提醒一次时间，常要具体数字' },
  { value: 'pressure', label: '压力面', desc: '追问 2–3 层，必须给数字和取舍，超 60 秒催结论' },
];

const DURATION_OPTIONS: { value: DurationMin; label: string }[] = [
  { value: 15, label: '15 分钟' },
  { value: 25, label: '25 分钟' },
  { value: 40, label: '40 分钟' },
];

export function SetupPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { track, atmosphere, durationMin, resumeText, setSetup, setSession } = useInterviewStore();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const text = resumeText.trim();
      const { id, snapshot } = await apiClient.createSession({
        track,
        atmosphere,
        durationMin,
        ...(text ? { resumeText: text } : {}),
      });
      setSession(id, snapshot);
      navigate(`/interview/${id}`);
    } catch {
      setError('创建面试失败，请确认后端已启动后重试');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="page page--setup">
      <Typography.Title level={2}>AI 数字人面试官</Typography.Title>
      <Typography.Paragraph type="secondary">
        面试官会先开口提问，你可以用语音或文字回答；你说话时页面会实时显示字幕，数字人说话时你可以随时打断。
      </Typography.Paragraph>

      <Card title="面试方向" className="setup-card">
        <Radio.Group value={track} onChange={(e) => setSetup({ track: e.target.value as Track })}>
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            {TRACK_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>
                <div>
                  <strong>{o.label}</strong>
                  <div className="option-desc">{o.desc}</div>
                </div>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Card>

      <Card title="面试氛围" className="setup-card">
        <Radio.Group value={atmosphere} onChange={(e) => setSetup({ atmosphere: e.target.value as Atmosphere })}>
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            {ATMOSPHERE_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>
                <div>
                  <strong>{o.label}</strong>
                  <div className="option-desc">{o.desc}</div>
                </div>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Card>

      <Card title="时长" className="setup-card">
        <Radio.Group value={durationMin} onChange={(e) => setSetup({ durationMin: e.target.value as DurationMin })}>
          <Space>
            {DURATION_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>
                {o.label}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Card>

      <Card title="简历摘要（可选）" className="setup-card">
        <Input.TextArea
          rows={4}
          value={resumeText}
          placeholder="贴几段项目经历，面试官会基于它提问；不填就按通用题库问"
          onChange={(e) => setSetup({ resumeText: e.target.value })}
        />
      </Card>

      {error && <Alert type="error" title={error} showIcon className="setup-error" />}

      <Button type="primary" size="large" loading={starting} onClick={() => void handleStart()}>
        开始面试
      </Button>
    </div>
  );
}
