/** 前端 ↔ 服务端在 WebSocket 上交换的消息。两边的唯一事实来源 */

/** 一个词的边界：TTS 引擎念到它时相对本段音频起点的偏移（毫秒） */
export interface WordTiming {
  /** 词文本（已去掉标点） */
  text: string;
  /** 相对本段音频起点的开始时间（ms） */
  offset: number;
  /** 持续时间（ms） */
  duration: number;
}

/** TTS：服务端 → 客户端（文本帧）。音频走二进制帧 */
export type TtsServerMessage =
  | { type: 'tts_start'; turnId: string; segId: number; text: string }
  /** 本段的词级时间戳。前端据此把口型对到念出的字上 */
  | { type: 'tts_words'; turnId: string; segId: number; words: WordTiming[]; audioMs?: number }
  | { type: 'tts_seg_done'; turnId: string; segId: number }
  | { type: 'tts_done'; turnId: string }
  | { type: 'tts_abort'; turnId: string }
  | { type: 'tts_error'; turnId: string; segId: number; message: string };

/** TTS：客户端 → 服务端 */
export type TtsClientMessage = { type: 'barge_in'; turnId: string } | { type: 'bye' };

/** ASR：客户端 → 服务端。音频走二进制帧，文本帧只用来标记一句话的起止 */
export type AsrClientMessage =
  | { type: 'utterance_start'; voiceId: string }
  | { type: 'utterance_end'; voiceId: string }
  | { type: 'utterance_cancel'; voiceId: string };

/** ASR：服务端 → 客户端 */
export type AsrServerMessage =
  | { type: 'asr_ready'; mode: 'mock' | 'live' }
  | { type: 'asr_partial'; voiceId: string; text: string }
  | { type: 'asr_final'; voiceId: string; text: string }
  | { type: 'asr_normalized'; voiceId: string; text: string }
  | { type: 'asr_error'; voiceId: string; message: string };

/** 新增一条消息类型时，用这个函数兜住 parse 失败 */
export function parseWsJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}