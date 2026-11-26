import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnv, loadEnv, logReadiness } from './config/config.module';
import { RealtimeServer } from './realtime/realtime.server';

async function bootstrap(): Promise<void> {
  const { env, missing } = loadEnv();
  logReadiness(env);

  if (missing.length > 0) {
    console.warn(`[config] 缺少配置：${missing.join(', ')}`);
    console.warn('[config] 运行 `node scripts/setup-env.mjs` 或手动补齐 apps/server/.env');
  }

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableCors({ origin: true });
  await app.listen(env.port);

  app.get(RealtimeServer).attach(app.getHttpServer());
  console.log(`[server] 已启动：http://localhost:${env.port}`);
  console.log(`[server] 语音通道：ws://localhost:${env.port}/ws/asr、/ws/tts（SPEECH_MODE=${env.speechMode}）`);
}

void bootstrap();