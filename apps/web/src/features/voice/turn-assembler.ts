import { TURN_HARD_LIMIT_MS, TURN_SILENCE_MS } from '@ai-interviewer/shared';

export type AssemblerEvent =
  | { type: 'segment_final'; text: string; at: number }
  | { type: 'tick'; at: number }
  | { type: 'manual_submit'; at: number };

export type SubmitReason = 'silence' | 'timeout' | 'manual';

export type AssemblerOutput = { type: 'submit'; text: string; reason: SubmitReason };

export interface AssemblerState {
  text: string;
  startedAt: number | null;
  lastSpeechAt: number | null;
}

/**
 * 一轮回答的组装器：把多段 ASR 终稿拼成一句完整回答，并在
 * 停顿超时 / 超过硬上限 / 手动提交时给出 `submit`。
 *
 * 纯状态机：时间由事件的 `at` 传入，方便测试；不持有计时器。
 */
export function createTurnAssembler() {
  let text = '';
  let startedAt: number | null = null;
  let lastSpeechAt: number | null = null;
  /** 最后一次拼进来的片段，供 replaceLast 定位 */
  let lastPiece = '';

  const reset = (): void => {
    text = '';
    startedAt = null;
    lastSpeechAt = null;
    lastPiece = '';
  };

  const submit = (reason: SubmitReason): AssemblerOutput[] => {
    const payload = text.trim();
    reset();
    if (payload === '') return [];
    return [{ type: 'submit', text: payload, reason }];
  };

  return {
    push(event: AssemblerEvent): AssemblerOutput[] {
      if (event.type === 'segment_final') {
        const piece = event.text.trim();
        if (piece === '') return [];
        text = text === '' ? piece : `${text} ${piece}`;
        startedAt ??= event.at;
        lastSpeechAt = event.at;
        lastPiece = piece;
        return [];
      }

      if (text.trim() === '') {
        // 没有内容就没什么可提交的，顺手清计时
        startedAt = null;
        lastSpeechAt = null;
        return [];
      }

      if (event.type === 'manual_submit') return submit('manual');

      // tick
      if (startedAt !== null && event.at - startedAt >= TURN_HARD_LIMIT_MS) return submit('timeout');
      if (lastSpeechAt !== null && event.at - lastSpeechAt >= TURN_SILENCE_MS) return submit('silence');
      return [];
    },

    state(): AssemblerState {
      return { text, startedAt, lastSpeechAt };
    },

    /**
     * 用归一后的文本替换最后一段（术语校正）。
     * 只在最后一段是与 lastFinal 相同结尾时替换，避免把别处改坏。
     */
    replaceLast(normalized: string): void {
      if (text === '' || normalized.trim() === '') return;
      const idx = text.lastIndexOf(lastPiece);
      if (idx === -1) {
        text = normalized;
      } else {
        text = `${text.slice(0, idx)}${normalized}`.trim();
      }
      lastPiece = normalized;
    },

    /** 提交过的文本已被消费，调用方主动清空（如取消本轮） */
    reset,
  };
}

export type TurnAssembler = ReturnType<typeof createTurnAssembler>;
