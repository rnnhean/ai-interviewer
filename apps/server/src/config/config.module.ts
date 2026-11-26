import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, readinessReport, type AppEnv } from './env';

let cached: { env: AppEnv; missing: string[] } | null = null;

/** 仓库根（apps/server/src/config → ../../../..） */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const ENV_FILE = path.join(ROOT_DIR, 'apps/server/.env');

/**
 * 读取一次 .env 并缓存。用 Node 内置 loadEnvFile，不引入 dotenv。
 * 已验证：loadEnvFile 不覆盖已存在的 process.env。
 */
export function loadEnv(): { env: AppEnv; missing: string[] } {
  if (cached) return cached;
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // 文件不存在时静默：由 missing 列表报出来
  }
  cached = parseEnv(process.env);
  return cached;
}

export function getEnv(): AppEnv {
  return loadEnv().env;
}

export function logReadiness(env: AppEnv): void {
  console.log(`[config]\n${readinessReport(env)}`);
}
