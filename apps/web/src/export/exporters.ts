import { saveAs } from 'file-saver';

/** 导出文件名兜底：服务端没给就按日期 + 方向拼一个 */
export function reportFileName(track: string, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `interview-${y}-${m}-${d}-${track}`;
}

/**
 * 下载导出文件。优先让浏览器直接走服务端 attachment（简单、不占内存）；
 * 服务端返回 202 时表示报告还没生成，抛特定错误交给页面提示。
 */
export async function downloadExport(sessionId: string, format: 'md' | 'json'): Promise<void> {
  const res = await fetch(`/api/interview/${sessionId}/export?format=${format}`);
  if (res.status === 202) throw new ExportPendingError();
  if (!res.ok) throw new Error(`导出失败：${res.status}`);

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const fallback = `${reportFileName(sessionId)}.${format}`;
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallback;

  const blob = await res.blob();
  saveAs(blob, filename);
}

export class ExportPendingError extends Error {
  constructor() {
    super('评价报告还在生成中');
    this.name = 'ExportPendingError';
  }
}
