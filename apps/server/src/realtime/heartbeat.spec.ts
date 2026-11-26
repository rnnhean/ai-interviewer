/**
 * 心跳测试。
 *
 * 这条逻辑关系到「连接死了要能回收」。测三件事：
 *   1. 按间隔发 ping
 *   2. 收到 pong 会清零计数
 *   3. 连续没 pong 就 terminate（释放会话资源）
 */

import { describe, expect, it } from 'vitest';
import { heartbeat, type HeartbeatSocket } from './heartbeat';

function fakeSocket(readyState = 1) {
    const pings: number[] = [];
    const listeners: { pong: (() => void)[] } = { pong: [] };
    const s = {
        readyState,
        pingCount: 0,
        terminated: false,
        ping() {
            s.pingCount++;
            pings.push(Date.now());
        },
        on(event: 'pong', fn: () => void) {
            listeners[event].push(fn);
            return s;
        },
        terminate() {
            s.terminated = true;
            s.readyState = 3;
        },
        emitPong() {
            for (const fn of listeners.pong) fn();
        },
    };
    return s as typeof s & HeartbeatSocket;
}

/** 手动驱动定时器：避免依赖真实时间，测试稳定 */
function manualTimer() {
    let handler: (() => void) | null = null;
    return {
        setIntervalFn: (fn: () => void) => {
            handler = fn;
            return 1;
        },
        clearIntervalFn: () => {
            handler = null;
        },
        tick() {
            handler?.();
        },
        get alive() {
            return handler !== null;
        },
    };
}

describe('heartbeat', () => {
    it('按周期发 ping', () => {
        const sock = fakeSocket();
        const t = manualTimer();
        const stop = heartbeat(sock, { intervalMs: 1000, ...t });
        t.tick();
        t.tick();
        expect(sock.pingCount).toBe(2);
        stop();
    });

    it('收到 pong 会清零，不会误杀健康连接', () => {
        const sock = fakeSocket();
        const t = manualTimer();
        const stop = heartbeat(sock, { intervalMs: 1000, missLimit: 2, ...t });
        t.tick(); // miss=1
        sock.emitPong(); // 清零
        t.tick(); // miss=1
        sock.emitPong();
        t.tick(); // miss=1
        expect(sock.terminated).toBe(false);
        stop();
    });

    it('连续 missLimit 个周期没 pong 就 terminate', () => {
        const sock = fakeSocket();
        const t = manualTimer();
        heartbeat(sock, { intervalMs: 1000, missLimit: 2, ...t });
        t.tick(); // miss=1 → ping
        t.tick(); // miss=2 → ping
        t.tick(); // miss>=2 → terminate
        expect(sock.terminated).toBe(true);
    });

    it('连接已关闭时不再 ping', () => {
        const sock = fakeSocket(3); // CLOSED
        const t = manualTimer();
        const stop = heartbeat(sock, { intervalMs: 1000, ...t });
        t.tick();
        expect(sock.pingCount).toBe(0);
        stop();
    });

    it('stop() 之后定时器不再触发', () => {
        const sock = fakeSocket();
        const t = manualTimer();
        const stop = heartbeat(sock, { intervalMs: 1000, ...t });
        stop();
        expect(t.alive).toBe(false);
        t.tick(); // 没有 handler，应当无事发生
        expect(sock.pingCount).toBe(0);
    });

    it('intervalMs <= 0 视为不挂心跳', () => {
        const sock = fakeSocket();
        const t = manualTimer();
        const stop = heartbeat(sock, { intervalMs: 0, ...t });
        expect(t.alive).toBe(false);
        stop();
        expect(sock.pingCount).toBe(0);
    });
});
