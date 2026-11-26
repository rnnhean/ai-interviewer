import { Injectable } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { getEnv } from '../config/config.module';

@Injectable()
export class LlmService {
  private readonly provider;
  readonly model: LanguageModel;

  constructor() {
    const env = getEnv();
    this.provider = createOpenAICompatible({
      name: 'dashscope',
      baseURL: env.llmBaseUrl,
      apiKey: env.llmApiKey,
    });
    this.model = this.provider(env.llmModel);
  }

  get modelId(): string {
    return getEnv().llmModel;
  }
}
