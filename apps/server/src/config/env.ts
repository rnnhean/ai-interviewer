export type SpeechMode = 'mock' | 'live';

export interface AppEnv {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  tencentSecretId: string;
  tencentSecretKey: string;
  tencentAppId: string;
  tencentAsrEngine: string;
  asrCorrectionModel: string;
  ttsProvider: string;
  edgeTtsVoice: string;
  ttsFallbackProvider: string;
  dashscopeTtsVoice: string;
  speechMode: SpeechMode;
  port: number;
}

/** 必填键（按此顺序校验与上报） */
const REQUIRED = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
  'TENCENT_APP_ID',
  'TENCENT_ASR_ENGINE',
  'ASR_CORRECTION_MODEL',
  'TTS_PROVIDER',
  'EDGE_TTS_VOICE',
] as const;

type EnvSource = Record<string, string | undefined>;

const str = (src: EnvSource, key: string, fallback = ''): string => {
  const v = src[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
};

/**
 * 解析环境变量。missing 只包含键名，永远不含值。
 */
export function parseEnv(src: EnvSource): { env: AppEnv; missing: string[] } {
  const missing = REQUIRED.filter((k) => str(src, k) === '');

  const rawMode = str(src, 'SPEECH_MODE', 'mock');
  const speechMode: SpeechMode = rawMode === 'live' ? 'live' : 'mock';

  const rawPort = Number.parseInt(str(src, 'PORT', '3001'), 10);
  const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 3001;

  const env: AppEnv = {
    llmApiKey: str(src, 'LLM_API_KEY'),
    llmBaseUrl: str(src, 'LLM_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    llmModel: str(src, 'LLM_MODEL', 'qwen-plus'),
    tencentSecretId: str(src, 'TENCENT_SECRET_ID'),
    tencentSecretKey: str(src, 'TENCENT_SECRET_KEY'),
    tencentAppId: str(src, 'TENCENT_APP_ID'),
    tencentAsrEngine: str(src, 'TENCENT_ASR_ENGINE', '16k_zh'),
    asrCorrectionModel: str(src, 'ASR_CORRECTION_MODEL', 'qwen3-asr-flash'),
    ttsProvider: str(src, 'TTS_PROVIDER', 'edge'),
    edgeTtsVoice: str(src, 'EDGE_TTS_VOICE', 'zh-CN-XiaoxiaoNeural'),
    ttsFallbackProvider: str(src, 'TTS_FALLBACK_PROVIDER', 'dashscope'),
    dashscopeTtsVoice: str(src, 'DASHSCOPE_TTS_VOICE', 'longxiaochun_v2'),
    speechMode,
    port,
  };

  return { env, missing };
}

/**
 * 启动日志用。只输出「已配置 / 缺失」，绝不输出值，也绝不读额度。
 */
export function readinessReport(env: AppEnv): string {
  const mark = (ok: boolean) => (ok ? '已配置' : '缺失');
  return [
    `LLM: ${mark(env.llmApiKey !== '')}`,
    `腾讯 ASR: ${mark(env.tencentSecretId !== '' && env.tencentSecretKey !== '' && env.tencentAppId !== '')}`,
    `终稿校正: ${mark(env.asrCorrectionModel !== '')}`,
    `TTS(edge): 已配置`,
    `语音模式: ${env.speechMode}`,
    `端口: ${env.port}`,
  ].join('\n');
}
