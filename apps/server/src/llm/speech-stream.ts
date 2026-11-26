/**
 * 把流式正文（可能被任意切分）转成「能读出口的整句」。
 *
 * 两件事必须同时做对：
 * 1. 代码围栏可能被切在 chunk 边界上（"``" + "`ts\n…"），所以围栏状态要跨 chunk 保留，
 *    并且按「见到闭合围栏才恢复朗读」处理——半个围栏不能泄漏成可朗读文本。
 * 2. TTS 要整句送入，不能一句念一半就送去。没有句末标点的尾巴先攒着。
 */
export class SpeechStreamer {
  /** 是否在 ``` 围栏内部 */
  private inFence = false;
  /** 上一个 chunk 末尾可能是半个围栏，留到下次拼接 */
  private carry = '';
  /** 已清洗、还没凑成整句的文本 */
  private pending = '';

  constructor(private readonly emit: (text: string) => void) {}

  push(delta: string): void {
    if (delta === '') return;
    const buf = this.carry + delta;
    this.carry = '';

    let i = 0;
    while (i < buf.length) {
      const fence = buf.indexOf('```', i);

      if (this.inFence) {
        if (fence === -1) {
          this.carry = trailingBackticks(buf.slice(i));
          i = buf.length;
        } else {
          this.inFence = false;
          i = fence + 3;
        }
        continue;
      }

      if (fence === -1) {
        const tail = trailingBackticks(buf.slice(i));
        this.append(buf.slice(i, buf.length - tail.length));
        this.carry = tail;
        i = buf.length;
        continue;
      }

      // 围栏前的正文照读
      this.append(buf.slice(i, fence));
      this.inFence = true;
      // 跳过 ``` 后面的语言标记
      const nl = buf.indexOf('\n', fence + 3);
      i = nl === -1 ? buf.length : nl + 1;
    }
  }

  /** 收尾：吐出最后不足一句的残留。没闭合的围栏整段丢弃 */
  flush(): void {
    this.carry = '';
    const rest = stripMarkup(this.pending).replace(/[`\s]+/g, ' ').trim();
    this.pending = '';
    if (rest !== '') this.emit(rest);
  }

  /** 累积清洗后的文本，凑够整句就送出 */
  private append(text: string): void {
    if (text === '') return;
    this.pending += stripMarkup(text).replace(/`/g, '');

    let cut = 0;
    for (const m of this.pending.matchAll(/[^。！？；\n]*[。！？；\n]+/g)) {
      cut = (m.index ?? 0) + m[0].length;
      const speakable = m[0].replace(/\s+/g, ' ').trim();
      if (speakable !== '') this.emit(speakable);
    }
    if (cut > 0) this.pending = this.pending.slice(cut);
  }
}

/** 末尾连续的 0~2 个反引号，可能是被切断的围栏 */
function trailingBackticks(text: string): string {
  const m = /`{1,2}$/.exec(text);
  return m ? m[0] : '';
}

/**
 * 去掉不该念出来的标记符号。
 *
 * 模型回答里常带 **加粗**、## 小标题、- 列表，直接送 TTS 会被念成
 * 「星号星号」「井号」，听感很差，还会打乱断句。
 */
function stripMarkup(text: string): string {
  return text
    .replace(/\*\*|__|~~/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/[*#]/g, '');
}