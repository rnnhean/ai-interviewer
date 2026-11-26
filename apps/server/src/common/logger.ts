/**
 * 统一脱敏日志。
 *
 * 规则：
 * - 键名命中 secret/key/token/password/authorization 的字段一律替换为 ***
 * - 字符串值里像密钥的长串（32 位以上十六进制、sk- 前缀）一律打码
 * - 任何一行出现疑似完整密钥时，写日志本身就会抛错（防止误打印）
 */

const SENSITIVE_KEY = /(secret|key|token|password|authorization|credential|apikey|appkey|sign)/i;
const SECRET_LIKE = /(sk-[A-Za-z0-9_-]{16,})|(\b[0-9a-f]{32,}\b)|(\bAKID[A-Za-z0-9]{16,}\b)/g;

export type LogFields = Record<string, unknown>;

export function redactString(input: string): string {
  return input.replace(SECRET_LIKE, '***');
}

export function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '***';
      continue;
    }
    if (typeof v === 'string') {
      out[k] = redactString(v);
      continue;
    }
    if (v && typeof v === 'object') {
      out[k] = redactFields(v as LogFields);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** 调试用断言：行内不得残留疑似完整密钥 */
export function assertNoSecret(line: string): void {
  const hits = line.match(SECRET_LIKE);
  if (hits && hits.length > 0) {
    throw new Error(`日志行疑似包含密钥（已拦截 ${hits.length} 处），拒绝输出`);
  }
}

export class RedactedLogger {
  constructor(private readonly scope: string) {}

  log(event: string, fields: LogFields = {}): void {
    const payload = { scope: this.scope, event, ...redactFields(fields) };
    const line = JSON.stringify(payload);
    assertNoSecret(line);
    console.log(line);
  }

  warn(event: string, fields: LogFields = {}): void {
    const payload = { scope: this.scope, event, level: 'warn', ...redactFields(fields) };
    const line = JSON.stringify(payload);
    assertNoSecret(line);
    console.warn(line);
  }

  error(event: string, fields: LogFields = {}): void {
    const payload = { scope: this.scope, event, level: 'error', ...redactFields(fields) };
    const line = JSON.stringify(payload);
    assertNoSecret(line);
    console.error(line);
  }
}
