import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Input, Result, Spin, Tooltip, App } from 'antd';
import type { DirectorCtrl, InterviewPhase } from '@ai-interviewer/shared';
import { apiClient, SessionGoneError } from '../api/client';
import { DigitalHuman } from '../components/DigitalHuman';
import { LiveCaption } from '../components/LiveCaption';
import { PhaseBadge } from '../components/PhaseBadge';
import { TranscriptList } from '../components/TranscriptList';
import { extractLastUserText, type InterviewUIMessage } from '../features/chat/messageText';
import { streamOpening, useInterviewChat } from '../features/chat/useInterviewChat';
import { useTtsSocket, type DigitalAvatarHandle } from '../features/voice/useTtsSocket';
import { useVoiceSession } from '../features/voice/useVoiceSession';
import { useInterviewStore } from '../store/interviewStore';

export interface InterviewPageProps {
  /** 测试注入：跳过网络初始化 */
  initialMessages?: InterviewUIMessage[];
  skipOpening?: boolean;
}

export function InterviewPage({ initialMessages, skipOpening }: InterviewPageProps = {}): React.JSX.Element {
  const { message } = App.useApp();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setSnapshot = useInterviewStore((s) => s.setSnapshot);
  const storePhase = useInterviewStore((s) => s.phase);
  const storeAsked = useInterviewStore((s) => s.askedInPhase);
  const setPhase = useInterviewStore((s) => s.setPhase);

  const [loading, setLoading] = useState(true);
  const [lost, setLost] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [interruptedIds, setInterruptedIds] = useState<Set<string>>(() => new Set());
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const openingStarted = useRef(false);
  /** 数字人加载完成后挂上，TTS 用它把音频送进 3D 口型通道 */
  const avatarRef = useRef<DigitalAvatarHandle | null>(null);
  const handleAvatarReady = useCallback((handle: DigitalAvatarHandle) => {
    avatarRef.current = handle;
  }, []);

  const handlePhase = useCallback((phase: InterviewPhase, askedInPhase: number) => setPhase(phase, askedInPhase), [setPhase]);
  const handleDirector = useCallback((_ctrl: DirectorCtrl) => {}, []);

  const chat = useInterviewChat({
    sessionId: id,
    onPhase: handlePhase,
    onDirector: handleDirector,
    ...(initialMessages ? { initialMessages } : {}),
  });

  // ---- 面试官语音 ----
  // 注意：不能用服务端的 tts_done 判断「说完了」。那是**合成**结束，
  // 音频还要继续播若干秒；拿它翻转状态会让尾巴那几秒既没有口型，
  // 也关掉打断检测。speaking 一律跟随播放器（onStart / onEnd）。
  const tts = useTtsSocket({
    sessionId: id,
    getAvatar: () => avatarRef.current,
    onUnavailable: () => setVoiceHint('语音播放不可用，本轮只有文字'),
  });
  const speaking = tts.speaking;

  // ---- 麦克风 / ASR / 打断 ----
  const sendRef = useRef<(text: string, source: 'voice' | 'text') => void>(() => {});
  const bargedInRef = useRef(false);

  const voice = useVoiceSession({
    sessionId: id,
    onSubmit: (text) => sendRef.current(text, 'voice'),
    onBargeIn: () => {
      // 打断检测一次对话只算一次，避免连续帧反复触发
      if (bargedInRef.current) return;
      bargedInRef.current = true;
      // 本地先停音频；服务端收到 barge_in 会停掉这一轮的合成
      tts.abortLocal();
      if (tts.currentTurnId) tts.bargeIn(tts.currentTurnId);
      // 服务端会中止这一轮生成，再把服务端这边的 turnController 也停掉，
      // 气泡上留住已经说出来的半句
      void apiClient.interrupt(id).catch(() => undefined);
      chat.stop();
      const last = chat.messages.at(-1);
      if (last && last.role === 'assistant') {
        setInterruptedIds((prev) => new Set(prev).add(last.id));
      }
    },
    onVoiceError: (text) => setVoiceHint(text),
  });

  // 打断判定要用最新引用，避免 useVoiceSession 里闭包过期
  const setInterviewerSpeaking = voice.setInterviewerSpeaking;
  useEffect(() => {
    if (speaking) bargedInRef.current = false;
    setInterviewerSpeaking(speaking);
  }, [speaking, setInterviewerSpeaking]);

  // 载入会话；404 说明进程重启过，会话已丢失
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getSession(id)
      .then((snapshot) => {
        if (cancelled) return;
        setSnapshot(snapshot);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof SessionGoneError) setLost(true);
        else setFatal('加载面试失败，请检查后端是否在运行');
      });
    return () => {
      cancelled = true;
    };
  }, [id, setSnapshot]);

  // 开场白只放一次
  useEffect(() => {
    if (loading || lost || fatal || skipOpening || openingStarted.current) return;
    openingStarted.current = true;
    void streamOpening(id, { onPhase: handlePhase, onDirector: handleDirector })
      .then((openingMessage) => {
        chat.setMessages([openingMessage]);
      })
      .catch(() => {
        message.error('开场白加载失败，可以点「重新开场」');
        openingStarted.current = false;
      });
    // chat.setMessages 是稳定引用，不放进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lost, fatal, skipOpening, id]);

  const send = useCallback(
    (text: string, source: 'voice' | 'text'): void => {
      const trimmed = text.trim();
      if (trimmed === '') return;
      chat.sendAnswer(trimmed, source);
    },
    [chat],
  );
  sendRef.current = send;

  const handleSubmit = (): void => {
    const trimmed = input.trim();
    if (trimmed === '') {
      message.warning('回答不能为空');
      return;
    }
    send(trimmed, 'text');
    setInput('');
  };

  const toggleMic = async (): Promise<void> => {
    if (voice.listening) {
      await voice.stopListening();
      return;
    }
    setVoiceHint(null);
    await voice.startListening();
  };

  const handleFinish = async (): Promise<void> => {
    const hide = message.loading('正在生成面试评价…', 0);
    try {
      await voice.stopListening();
      tts.abortLocal();
      const { snapshot } = await apiClient.finish(id);
      setSnapshot(snapshot);
      navigate(`/report/${id}`);
    } catch {
      message.error('生成评价失败，请重新结束面试');
    } finally {
      hide();
    }
  };

  const streaming = chat.status === 'streaming' || chat.status === 'submitted';
  const asrLabel = useMemo(() => {
    if (!voice.listening) return null;
    if (!voice.connected) return '语音通道连接中…';
    return voice.asrMode === 'mock' ? '语音识别（演示模式）' : '语音识别';
  }, [voice.listening, voice.connected, voice.asrMode]);

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
        subTitle="面试状态只保存在服务端内存里，服务重启或页面刷新过久就会丢失。请重新开始一场面试。"
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            返回开始页
          </Button>
        }
      />
    );
  }

  if (fatal) {
    return (
      <div className="page">
        <Alert type="error" title={fatal} showIcon />
        <Button style={{ marginTop: 16 }} onClick={() => navigate('/')}>
          返回开始页
        </Button>
      </div>
    );
  }

  return (
    <div className="interview-layout">
      {/* 数字人独立占一竖栏：横条里人像只有中间一小块，脸小到看不出嘴形 */}
      <div className="stage">
        <DigitalHuman
          speaking={speaking}
          onReady={handleAvatarReady}
          label={speaking ? '正在说话（可以直接开口打断）' : undefined}
        />
      </div>

      <main className="interview-main">
        <TranscriptList messages={chat.messages} interruptedIds={interruptedIds} streamingId={null} />

        <div className="composer">
          <LiveCaption partial={voice.partial} draft={voice.draft || input} listening={voice.listening} />
          <div className="composer__row">
            <Tooltip title={voice.available ? (voice.listening ? '关闭麦克风' : '开麦克风说话') : '麦克风不可用'}>
              <Button
                className="mic-button"
                type={voice.listening ? 'primary' : 'default'}
                danger={voice.listening}
                disabled={!voice.available}
                onClick={() => void toggleMic()}
                aria-label={voice.listening ? '关闭麦克风' : '开麦克风'}
              >
                {voice.listening ? '🎙 录音中' : '🎙 语音'}
              </Button>
            </Tooltip>
            <Input.TextArea
              value={input}
              autoSize={{ minRows: 1, maxRows: 5 }}
              placeholder="用文字回答（Ctrl+Enter 发送）"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button type="primary" disabled={streaming || input.trim() === ''} onClick={handleSubmit}>
              发送
            </Button>
          </div>
          {(asrLabel || voiceHint) && (
            <div style={{ fontSize: 12, color: voiceHint ? '#c4553c' : '#8a919f', marginTop: 6 }}>
              {voiceHint ?? asrLabel}
            </div>
          )}
        </div>
      </main>

      <aside className="interview-side">
        <div className="side-card">
          <PhaseBadge phase={storePhase} askedInPhase={storeAsked} />
        </div>

        <div className="side-card">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>当前回答</div>
          <div style={{ fontSize: 13, color: '#8a919f' }}>
            {voice.draft || extractLastUserText(chat.messages) || '还没有回答'}
          </div>
        </div>

        <div className="side-card" style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
          <Button danger block onClick={() => void handleFinish()}>
            结束面试并生成评价
          </Button>
        </div>
      </aside>
    </div>
  );
}
