/// <reference types="vite/client" />

/**
 * 项目只用到 import.meta.env.DEV 一个字段，这里显式声明，
 * 不额外引入完整的 vite/client 类型（会和现有的 DOM lib 冲突排查变麻烦）。
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
