declare module 'mse-audio-wrapper' {
  export interface MSEAudioWrapperOptions {
    preferredContainer?: string;
    minFramesPerSegment?: number;
    maxFramesPerSegment?: number;
    minBytesPerSegment?: number;
    codec?: string;
    onMimeType?: (mimeType: string) => void;
    onCodecUpdate?: (codec: string) => void;
    enableLogging?: boolean;
  }

  /** 把 mp3/aac 等裸流包成 fMP4 / WebM，供 MediaSource 增量喂 */
  export default class MSEAudioWrapper {
    constructor(mimeType: string, options?: MSEAudioWrapperOptions);
    readonly mimeType: string;
    readonly inputMimeType: string;
    iterator(chunk: Uint8Array): IterableIterator<Uint8Array>;
  }

  export function getWrappedMimeType(codec: string, container?: string): string;
}
