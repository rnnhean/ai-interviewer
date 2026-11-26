import { describe, expect, it } from 'vitest';
import { modelAnswering, silentModel } from '../testing/mock-model';
import { TermNormalizer } from './normalizer.service';

describe('TermNormalizer', () => {
  it('谐音词被纠正', async () => {
    const n = new TermNormalizer(modelAnswering('用 NestJS 写接口'), 800);
    await expect(n.normalize('用 给西斯诺特 写接口')).resolves.toBe('用 NestJS 写接口');
  });

  it('超时后返回原文', async () => {
    const n = new TermNormalizer(silentModel(), 50);
    const t0 = Date.now();
    await expect(n.normalize('用 给西斯诺特 写接口')).resolves.toBe('用 给西斯诺特 写接口');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('模型返回空串时回退原文', async () => {
    const n = new TermNormalizer(modelAnswering('   '), 800);
    await expect(n.normalize('原话')).resolves.toBe('原话');
  });

  it('去掉模型加的引号', async () => {
    const n = new TermNormalizer(modelAnswering('“我用的 RAG”'), 800);
    await expect(n.normalize('我用的拉格')).resolves.toBe('我用的 RAG');
  });

  it('过短的文本不调用模型', async () => {
    const model = modelAnswering('不该出现');
    const n = new TermNormalizer(model, 800);
    await expect(n.normalize('嗯')).resolves.toBe('嗯');
  });
});