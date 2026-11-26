import { describe, expect, it } from 'vitest';
import { assertNoSecret, redactFields, redactString } from './logger';

describe('redactString', () => {
  it('打码 sk- 前缀密钥', () => {
    expect(redactString('key is sk-abcdefghijklmnop1234 ok')).toBe('key is *** ok');
  });
  it('打码 32 位以上十六进制', () => {
    expect(redactString('token=0123456789abcdef0123456789abcdef')).toBe('token=***');
  });
  it('打码 AKID 前缀', () => {
    expect(redactString('id AKIDabcdefghijklmnop123')).toBe('id ***');
  });
  it('普通文本不变', () => {
    expect(redactString('第 3 轮耗时 812ms')).toBe('第 3 轮耗时 812ms');
  });
});

describe('redactFields', () => {
  it('敏感键名一律替换', () => {
    const r = redactFields({ apiKey: 'abc', user: 'han', Authorization: 'Bearer x' });
    expect(r.apiKey).toBe('***');
    expect(r.Authorization).toBe('***');
    expect(r.user).toBe('han');
  });
  it('嵌套对象同样处理', () => {
    const r = redactFields({ cfg: { secretKey: 'z', host: 'localhost' } });
    expect(r).toEqual({ cfg: { secretKey: '***', host: 'localhost' } });
  });
});

describe('assertNoSecret', () => {
  it('含完整密钥时抛错', () => {
    expect(() => assertNoSecret('leak sk-abcdefghijklmnop1234')).toThrow();
  });
  it('干净行不抛错', () => {
    expect(() => assertNoSecret('{"event":"turn","ms":812}')).not.toThrow();
  });
});
