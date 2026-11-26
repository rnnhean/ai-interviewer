import type { CreateSessionInput, SessionSnapshot } from '@ai-interviewer/shared';

/** 会话不存在 / 已被服务端回收 */
export class SessionGoneError extends Error {
  constructor() {
    super('会话已丢失');
    this.name = 'SessionGoneError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 404) throw new SessionGoneError();
  if (!res.ok) throw new Error(`请求失败：${res.status}`);
  return (await res.json()) as T;
}

export const apiClient = {
  createSession(input: CreateSessionInput): Promise<{ id: string; snapshot: SessionSnapshot }> {
    return request('/api/interview', { method: 'POST', body: JSON.stringify(input) });
  },

  getSession(id: string): Promise<SessionSnapshot> {
    return request(`/api/interview/${id}`);
  },

  interrupt(id: string): Promise<{ interrupted: boolean }> {
    return request(`/api/interview/${id}/interrupt`, { method: 'POST' });
  },

  nudge(id: string): Promise<{ text: string }> {
    return request(`/api/interview/${id}/nudge`, { method: 'POST' });
  },

  finish(id: string): Promise<{ snapshot: SessionSnapshot }> {
    return request(`/api/interview/${id}/finish`, { method: 'POST' });
  },

  /** 导出链接：交给浏览器直接下载，省一次 blob 中转 */
  exportUrl(id: string, format: 'md' | 'json'): string {
    return `/api/interview/${id}/export?format=${format}`;
  },
};

/** 语音通道地址。vite 代理会把 /ws 转到后端 */
export function wsUrl(path: string, sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}?session=${encodeURIComponent(sessionId)}`;
}
