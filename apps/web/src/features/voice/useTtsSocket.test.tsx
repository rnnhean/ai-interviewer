import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTtsSocket } from './useTtsSocket';

type Listener = (ev: unknown) => void;

/** vi.mock 会被提升到文件顶部，桩必须用 hoisted 定义 */
const hoisted = vi.hoisted(() => {
  class FakeSocket {
    static last: FakeSocket | null = null;
    readyState = 0;
    binaryType = '';
    sent: string[] = [];
    private listeners = new Map<string, Listener[]>();

    constructor(public url: string) {
      FakeSocket.last = this;
    }

    addEventListener(type: string, fn: Listener): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }

    removeEventListener(type: string, fn: Listener): void {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }

    open(): void {
      this.readyState = 1;
      this.emit('open', {});
    }

    emit(type: string, ev: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }

    send(data: string): void {
      this.sent.push(data);
    }

    close(): void {
      this.readyState = 3;
    }
  }

  const playerSpies = {
    push: vi.fn(),
    end: vi.fn(),
    abort: vi.fn(),
  };

  return { FakeSocket, playerSpies };
});

vi.mock('./tts-player', () => ({
  createTtsPlayer: () => ({
    mode: 'blob' as const,
    push: hoisted.playerSpies.push,
    end: hoisted.playerSpies.end,
    abort: hoisted.playerSpies.abort,
  }),
}));

vi.mock('reconnecting-websocket', () => ({
  default: hoisted.FakeSocket,
}));

const { FakeSocket, playerSpies } = hoisted;

function Harness(props: { onTurnState?: (s: string, t: string) => void; onUnavailable?: (e: unknown) => void }) {
  const tts = useTtsSocket({ sessionId: 's-1', ...props });
  return (
    <div>
      <span data-testid="state">{tts.state}</span>
      <span data-testid="turn">{tts.currentTurnId ?? '-'}</span>
      <button onClick={() => tts.bargeIn('turn-1')}>barge</button>
    </div>
  );
}

describe('useTtsSocket', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    playerSpies.push.mockClear();
    playerSpies.end.mockClear();
    playerSpies.abort.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('同一轮的多个分片只建一个播放器', async () => {
    const { getByTestId } = render(<Harness />);
    const socket = FakeSocket.last!;
    act(() => socket.open());

    act(() => {
      socket.emit('message', {
        data: JSON.stringify({ type: 'tts_start', turnId: 't1', segId: 0, text: '第一句。' }),
      });
    });
    act(() => {
      socket.emit('message', {
        data: JSON.stringify({ type: 'tts_start', turnId: 't1', segId: 1, text: '第二句。' }),
      });
    });

    expect(getByTestId('state')).toHaveTextContent('speaking');
    // 建第二个播放器会 abort 掉第一个
    expect(playerSpies.abort).not.toHaveBeenCalled();
  });

  it('换到新的一轮时丢弃旧播放器，避免两轮音频交叉', async () => {
    render(<Harness />);
    const socket = FakeSocket.last!;
    act(() => socket.open());

    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_start', turnId: 't1', segId: 0, text: '第一轮。' }) });
    });
    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_start', turnId: 't2', segId: 0, text: '第二轮。' }) });
    });

    expect(playerSpies.abort).toHaveBeenCalledTimes(1);
  });

  it('二进制帧喂给播放器，tts_done 触发 end', async () => {
    render(<Harness />);
    const socket = FakeSocket.last!;
    act(() => socket.open());

    act(() => {
      socket.emit('message', { data: new Uint8Array([1, 2, 3]).buffer });
    });
    expect(playerSpies.push).toHaveBeenCalledTimes(1);

    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_done', turnId: 't1' }) });
    });
    expect(playerSpies.end).toHaveBeenCalledTimes(1);
  });

  it('barge_in 立刻静音并通知服务端', async () => {
    const { getByText, getByTestId } = render(<Harness />);
    const socket = FakeSocket.last!;
    act(() => socket.open());

    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_start', turnId: 'turn-1', segId: 0, text: '你好。' }) });
    });
    act(() => getByText('barge').click());

    expect(playerSpies.abort).toHaveBeenCalled();
    expect(getByTestId('state')).toHaveTextContent('idle');
    expect(socket.sent.some((s) => s.includes('barge_in'))).toBe(true);
  });

  it('tts_abort 丢弃播放器并回到 idle', async () => {
    const { getByTestId } = render(<Harness />);
    const socket = FakeSocket.last!;
    act(() => socket.open());

    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_start', turnId: 't1', segId: 0, text: '你好。' }) });
    });
    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_abort', turnId: 't1' }) });
    });

    await waitFor(() => expect(getByTestId('state')).toHaveTextContent('idle'));
    expect(getByTestId('turn')).toHaveTextContent('-');
  });

  it('坏掉的 JSON 不影响后续消息', async () => {
    const { getByTestId } = render(<Harness />);
    const socket = FakeSocket.last!;
    act(() => socket.open());

    act(() => socket.emit('message', { data: '{not json' }));
    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'tts_start', turnId: 't9', segId: 0, text: '继续。' }) });
    });

    expect(getByTestId('turn')).toHaveTextContent('t9');
  });
});
