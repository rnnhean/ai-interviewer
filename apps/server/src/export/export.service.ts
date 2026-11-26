import type { Atmosphere, InterviewReport, SessionSnapshot, Track } from '@ai-interviewer/shared';
import { DIMENSION_LABEL } from '@ai-interviewer/shared';

const TRACK_LABEL: Record<Track, string> = {
  'agent-engineer': 'Agent 开发工程师',
  'frontend-to-agent': '前端转 Agent 开发',
  'backend-ai': '后端 + AI 工程化',
};

const ATMOSPHERE_LABEL: Record<Atmosphere, string> = {
  gentle: '温和引导',
  standard: '标准',
  pressure: '压力面',
};

const SOURCE_LABEL = { voice: '语音', text: '文字' } as const;

/** 完整面试记录 → Markdown */
export function toMarkdown(snapshot: SessionSnapshot): string {
  const lines: string[] = [];

  lines.push('# AI 数字人面试记录', '');
  lines.push('## 面试信息', '');
  lines.push(`- 方向：${TRACK_LABEL[snapshot.track]}`);
  lines.push(`- 氛围：${ATMOSPHERE_LABEL[snapshot.atmosphere]}`);
  lines.push(`- 计划时长：${snapshot.durationMin} 分钟`);
  lines.push(`- 开始时间：${formatDateTime(snapshot.startedAt)}`);
  lines.push(`- 出题数：${snapshot.askedTotal}`);
  lines.push(`- 有效回答：${snapshot.rounds.length} 轮`);
  lines.push('');

  lines.push('## 完整对话', '');
  if (snapshot.rounds.length === 0) {
    lines.push('_本次面试没有记录到有效的问答轮次。_', '');
  } else {
    for (const r of snapshot.rounds) {
      lines.push(`### 第 ${r.index} 轮`, '');
      lines.push(`**面试官**（${formatTime(r.submittedAt)}）：${orEmpty(r.question)}`, '');
      const tag = SOURCE_LABEL[r.source] + (r.interrupted ? '，被打断' : '');
      lines.push(`**候选人**（${tag}）：${orEmpty(r.answer)}`, '');
    }
  }

  lines.push('## 评价报告', '');
  if (!snapshot.report) {
    lines.push('_评价报告尚未生成。_', '');
  } else {
    lines.push(renderReport(snapshot.report));
  }

  lines.push('## 逐题回看', '');
  if (snapshot.rounds.length === 0) {
    lines.push('_没有可回看的轮次。_');
  } else {
    for (const r of snapshot.rounds) {
      lines.push(`- **第 ${r.index} 轮**：${clip(orEmpty(r.question), 60)}`);
      lines.push(`  - 你的回答：${clip(orEmpty(r.answer), 80)}${r.interrupted ? '（被打断）' : ''}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function renderReport(report: InterviewReport): string {
  const lines: string[] = [];
  lines.push(`**总分：${report.total} / 100**${report.fallback ? '（评价模型未返回结果，本报告为降级版本）' : ''}`, '');

  lines.push('### 维度评分', '');
  lines.push('| 维度 | 分数 | 评价 |');
  lines.push('| --- | --- | --- |');
  for (const d of report.dimensions) {
    lines.push(`| ${DIMENSION_LABEL[d.key]} | ${d.score} / 10 | ${escapeCell(d.comment)} |`);
  }
  lines.push('');

  lines.push('### 好的地方', '');
  if (report.strengths.length === 0) lines.push('_无_');
  for (const s of report.strengths) {
    lines.push(`- 「${s.quote}」——${s.why}`);
  }
  lines.push('');

  lines.push('### 不足', '');
  if (report.gaps.length === 0) lines.push('_无_');
  for (const g of report.gaps) {
    lines.push(`- 「${g.quote}」`);
    lines.push(`  - 问题：${g.issue}`);
    lines.push(`  - 建议：${g.suggestion}`);
  }
  lines.push('');

  lines.push('### 需要提高', '');
  report.actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push('');

  return lines.join('\n');
}

/** 与前端消息模型一致的 JSON，便于以后做分析 */
export function toJson(snapshot: SessionSnapshot): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      meta: {
        track: snapshot.track,
        atmosphere: snapshot.atmosphere,
        durationMin: snapshot.durationMin,
        startedAt: new Date(snapshot.startedAt).toISOString(),
        askedTotal: snapshot.askedTotal,
        status: snapshot.status,
      },
      rounds: snapshot.rounds,
      report: snapshot.report ?? null,
    },
    null,
    2,
  );
}

/** 导出文件名：interview-YYYY-MM-DD-<track>.md / .json */
export function exportFileName(snapshot: SessionSnapshot, now = new Date()): { md: string; json: string } {
  const base = `interview-${localDate(now)}-${snapshot.track}`;
  return { md: `${base}.md`, json: `${base}.json` };
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${localDate(d)} ${formatTime(ts)}`;
}

function orEmpty(text: string): string {
  const t = text.trim();
  return t === '' ? '（未记录）' : t;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}