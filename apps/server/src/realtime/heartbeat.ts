/**
 * WebSocket 心跳。
 *
 * 为什么需要：两条 WS 通道（/ws/tts 面试官语音、/ws/asr 候选人麦克风）都是
 * 长连接。中间代理（nginx / 负载均衡）对**空闲连接**有空闲超时；候选人思考时
 * 可能几十秒不发任何数据，连接就被掐掉——表现是「偶尔说到一半就没声音了」。
 *
 * 做法：服务端周期性发 WS 协议层的 ping 帧。ping 是**控制帧**，不占消息通道，
 * 前端不需要写业务处理；浏览器/ws 客户端会自动回 pong。
 *
 * 只发 ping 是不够的：连接已死但 TCP 还没探测到的「半开连接」上，send 不会报错。
 * 所以要**跟踪 pong**：连续若干个周期没收到 pong，就主动 terminate，把资源还给
 * 服务端（否则每个死连接都会一直占着会话与内存）。
 */

export interface HeartbeatSocket {
    readyState: number;
    ping(data?: unknown, mask?: boolean, cb?: (err?: Error) => void): void;
    on(event: 'pong', listener: () => void): unknown;
    terminate(): void;
}

/** ws 的 OPEN 常量；不引 ws 包避免耦合 */
const WS_OPEN = 1;

export interface HeartbeatOptions {
    /** ping 间隔，默认 25s（小于常见的 60s 空闲超时） */
    intervalMs?: number;
    /** 连续多少个周期没收到 pong 就判定死连接，默认 2 */
    missLimit?: number;
    /** 注入定时器，便于测试 */
    setIntervalFn?: (fn: () => void, ms: number) => unknown;
    clearIntervalFn?: (h: unknown) => void;
}

/**
 * 给一条已建立的连接挂心跳，返回停止函数（**必须在 close 时调用**）。
 */
export function heartbeat(socket: HeartbeatSocket, opts: HeartbeatOptions = {}): () => void {
    const intervalMs = opts.intervalMs ?? 25_000;
    const missLimit = opts.missLimit ?? 2;
    const setI = opts.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
    const clearI = opts.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

    if (!(intervalMs > 0)) return () => {};

    let missed = 0;
    // 有 pong 回来就清零：说明链路还是通的
    socket.on('pong', () => {
        missed = 0;
    });

    const handle = setI(() => {
        if (socket.readyState !== WS_OPEN) return;
        if (missed >= missLimit) {
            // 已经连续几个周期没回应，判定为死连接：主动断开，释放会话资源
            socket.terminate();
            return;
        }
        missed++;
        try {
            socket.ping();
        } catch {
            // 写失败说明连接已断，交给 close/error 处理
        }
    }, intervalMs);

    (handle as { unref?: () => void }).unref?.();

    return () => clearI(handle);
}
