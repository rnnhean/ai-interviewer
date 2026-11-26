import type { DirectorCtrl } from '@ai-interviewer/shared';

const PREFIX = '<<CTRL ';
const MOVES = new Set(['follow_up', 'advance', 'close']);
const PHASES = new Set(['intro', 'project', 'fundamentals', 'scenario', 'reverse', 'done']);

export interface ParseResult {
  ctrl?: DirectorCtrl;
  text: string;
}

/**
 * 流式剥离模型输出首行的 `<<CTRL {...}>>` 控制行。
 *
 * 约定：控制行必须出现在正文之前，单独占一行，后面跟一个空行。
 * 只要判断出首行不是控制行，立刻进入直通模式并把已缓冲的文本一次性吐出。
 */
export class DirectorStreamParser {
  private head = '';
  private decided = false;
  /** 决定直通后已吐出的文本不再重复 */
  private passthrough = false;
  private _violated = false;
  /** 控制行已解析但还没返回给调用方 */
  private pendingCtrl: DirectorCtrl | undefined;
  /** 控制行后面那个空行还没吃掉（可能跨 chunk） */
  private stripTrailingBlank = false;

  get violated(): boolean {
    return this._violated;
  }

  push(chunk: string): ParseResult {
    if (this.passthrough) {
      let text = chunk;
      if (this.stripTrailingBlank) {
        // 控制行后面那个空行可能落在下一个 chunk 里
        if (text.startsWith('\r\n')) text = text.slice(2);
        else if (text.startsWith('\n')) text = text.slice(1);
        if (text !== '') this.stripTrailingBlank = false;
      }
      const ctrl = this.pendingCtrl;
      this.pendingCtrl = undefined;
      return ctrl ? { ctrl, text } : { text };
    }

    this.head += chunk;

    const trimmed = this.head.replace(/^[\s﻿]+/, '');

    // 还在判断首行：缓冲不够就等
    if (!this.canDecide(trimmed)) {
      return { text: '' };
    }

    if (!trimmed.startsWith(PREFIX)) {
      return this.goPassthrough(this.head);
    }

    // 找控制行的结束换行
    const closeIdx = trimmed.indexOf('\n');
    if (closeIdx === -1) {
      // 有的模型会把控制行写在最后、后面不跟换行，JSON 已经闭合就直接收
      const only = this.parseWholeCtrlLine(trimmed);
      if (only) return only;
      return { text: '' };
    }

    const ctrlLine = trimmed.slice(0, closeIdx).replace(/\r$/, '');
    let rest = trimmed.slice(closeIdx + 1);
    // 吃掉紧随的一个空行；若本 chunk 里没有，标记留到下个 chunk 吃
    if (rest.startsWith('\r\n')) rest = rest.slice(2);
    else if (rest.startsWith('\n')) rest = rest.slice(1);
    else this.stripTrailingBlank = true;

    return this.finishCtrl(ctrlLine, rest);
  }

  flush(): ParseResult {
    if (this.passthrough) return { text: '' };
    const rest = this.head;
    this.head = '';
    this.passthrough = true;
    if (rest.trim() === '') return { text: '' };
    const only = this.parseWholeCtrlLine(rest.trim());
    if (only) return only;
    this._violated = true;
    // 半截控制行宁可丢掉，也不要漏给候选人
    if (rest.trim().startsWith(PREFIX)) return { text: '' };
    return { text: rest };
  }

  /** 缓冲是否已足以判断首行起点 */
  private canDecide(trimmed: string): boolean {
    if (trimmed === '') return false;
    const n = Math.min(trimmed.length, PREFIX.length);
    return trimmed.slice(0, n) !== PREFIX.slice(0, n) || trimmed.length >= PREFIX.length;
  }

  private goPassthrough(text: string): ParseResult {
    this.decided = true;
    this.passthrough = true;
    this.head = '';
    this._violated = true;
    return { text };
  }

  /** 一整段只剩控制行（没有换行、也没有正文）时，JSON 闭合即可收下 */
  private parseWholeCtrlLine(text: string): ParseResult | undefined {
    if (!text.startsWith(PREFIX)) return undefined;
    if (!/^<<CTRL\s*\{[\s\S]*\}\s*>+$/.test(text)) return undefined;
    return this.finishCtrl(text, '');
  }

  private finishCtrl(ctrlLine: string, rest: string): ParseResult {
    this.decided = true;
    this.passthrough = true;
    this.head = '';
    const ctrl = this.parseLine(ctrlLine);
    return ctrl ? { ctrl, text: rest } : { text: rest };
  }

  private parseLine(ctrlLine: string): DirectorCtrl | undefined {
    if (!ctrlLine.startsWith(PREFIX)) {
      this._violated = true;
      return undefined;
    }
    // 模型实际会写成 `>`、`>>`、`>>>`，统一剥掉结尾的尖括号再看 JSON
    const json = ctrlLine.slice(PREFIX.length).replace(/>+\s*$/, '').trim();
    try {
      const raw = JSON.parse(json) as Partial<DirectorCtrl>;
      if (
        typeof raw.move !== 'string' ||
        !MOVES.has(raw.move) ||
        typeof raw.phase !== 'string' ||
        !PHASES.has(raw.phase) ||
        typeof raw.asked !== 'number' ||
        !Number.isFinite(raw.asked)
      ) {
        this._violated = true;
        return undefined;
      }
      return { move: raw.move as DirectorCtrl['move'], phase: raw.phase as DirectorCtrl['phase'], asked: raw.asked };
    } catch {
      this._violated = true;
      return undefined;
    }
  }
}
