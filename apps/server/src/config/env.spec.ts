import { describe, expect, it } from 'vitest';
import { parseEnv, readinessReport } from './env';

const full = {
  LLM_API_KEY: 'sk-test-1234567890',
  LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  LLM_MODEL: 'qwen-plus',
  TENCENT_SECRET_ID: 'AKIDxxxxxxxxxxxxxxxx',
  TENCENT_SECRET_KEY: 'yyyyyyyyyyyyyyyyyyyy',
  TENCENT_APP_ID: '1312591814',
  TENCENT_ASR_ENGINE: '16k_zh',
  ASR_CORRECTION_MODEL: 'qwen3-asr-flash',
  TTS_PROVIDER: 'edge',
  EDGE_TTS_VOICE: 'zh-CN-XiaoxiaoNeural',
  TTS_FALLBACK_PROVIDER: 'dashscope',
  DASHSCOPE_TTS_VOICE: 'longxiaochun_v2',
  SPEECH_MODE: 'mock',
  PORT: '3001',
} as const;

describe('parseEnv', () => {
  it('完整配置时 missing 为空', () => {
    expect(parseEnv(full).missing).toEqual([]);
  });

  it('缺键只报键名，不报值', () => {
    const r = parseEnv({ ...full, TENCENT_SECRET_KEY: '' });
    expect(r.missing).toEqual(['TENCENT_SECRET_KEY']);
    expect(JSON.stringify(r.missing)).not.toContain('AKIDxxxxxxxxxxxxxxxx');
  });

  it('SPEECH_MODE 非法时回落到 mock', () => {
    expect(parseEnv({ ...full, SPEECH_MODE: 'weird' }).env.speechMode).toBe('mock');
  });

  it('SPEECH_MODE=live 原样保留', () => {
    expect(parseEnv({ ...full, SPEECH_MODE: 'live' }).env.speechMode).toBe('live');
  });

  it('PORT 非法时回落到 3001', () => {
    expect(parseEnv({ ...full, PORT: 'abc' }).env.port).toBe(3001);
  });

  it('字段映射到 camelCase', () => {
    const { env } = parseEnv(full);
    expect(env.llmApiKey).toBe('sk-test-1234567890');
    expect(env.llmModel).toBe('qwen-plus');
    expect(env.tencentAppId).toBe('1312591814');
    expect(env.edgeTtsVoice).toBe('zh-CN-XiaoxiaoNeural');
  });
});

describe('readinessReport', () => {
  it('只输出已配置/缺失，不含任何密钥值', () => {
    const text = readinessReport(parseEnv(full).env);
    expect(text).toContain('LLM: 已配置');
    expect(text).toContain('腾讯 ASR: 已配置');
    expect(text).not.toContain('sk-test');
    expect(text).not.toContain('AKID');
    expect(text).not.toContain('yyyy');
  });

  it('缺配置时标出缺失', () => {
    const { env } = parseEnv({ ...full, TENCENT_SECRET_KEY: '' });
    expect(readinessReport(env)).toContain('腾讯 ASR: 缺失');
  });

  it('打印语音模式', () => {
    expect(readinessReport(parseEnv(full).env)).toContain('语音模式: mock');
  });
});
