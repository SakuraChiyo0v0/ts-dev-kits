/** 加密后端：包装任意 ConfigBackend，写入时 AES-256-GCM 加密、读取时解密。 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { WebdavError, WebdavErrorCode } from "@sakurachiyo0v0/webdav";
import type { ConfigBackend } from "./backend.js";

/** 加密密钥的环境变量名（缺省兜底）。 */
export const CONFIG_ENCRYPTION_KEY_ENV = "CONFIG_KEY";

/** 把用户提供的密钥统一派生为 32 字节 AES-256 密钥。 */
export function deriveKey(key: string): Buffer {
  if (key.length === 64 && /^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, "hex");
  if (key.length === 44) {
    const decoded = Buffer.from(key, "base64");
    if (decoded.length === 32) return decoded;
  }
  return createHash("sha256").update(key, "utf8").digest();
}

function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decrypt(payload: string, key: Buffer): string {
  const parsed = JSON.parse(payload) as { v?: unknown; iv?: string; tag?: string; data?: string };
  if (parsed.v !== 1 || parsed.iv === undefined || parsed.tag === undefined || parsed.data === undefined) {
    throw new Error("密文格式非法(缺少 iv/tag/data)");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString("utf8");
}

/** 加密后端：包装任意后端，值以密文字符串存储。 */
export class EncryptedBackend implements ConfigBackend {
  readonly #inner: ConfigBackend;
  readonly #key: Buffer;

  constructor(inner: ConfigBackend, key: string) {
    this.#inner = inner;
    this.#key = deriveKey(key);
  }

  async load<T = unknown>(key: string): Promise<T> {
    const ciphertext = await this.#inner.load<string>(key);
    return JSON.parse(decrypt(ciphertext, this.#key)) as T;
  }

  async save(key: string, value: unknown): Promise<void> {
    await this.#inner.save(key, encrypt(JSON.stringify(value), this.#key));
  }

  list(): Promise<string[]> {
    return this.#inner.list();
  }

  remove(key: string): Promise<void> {
    return this.#inner.remove(key);
  }

  withPrefix(prefix: string): ConfigBackend {
    return new EncryptedBackend(this.#inner.withPrefix(prefix), this.#key.toString("hex"));
  }
}

/** 便捷工厂。key 缺省读环境变量 CONFIG_KEY。 */
export function encryptedBackend(inner: ConfigBackend, key?: string): ConfigBackend {
  const k = key ?? process.env[CONFIG_ENCRYPTION_KEY_ENV];
  if (k === undefined || k === "") {
    throw new WebdavError(
      WebdavErrorCode.VALIDATION,
      `缺少加密密钥:传 key 或设置环境变量 ${CONFIG_ENCRYPTION_KEY_ENV}`,
    );
  }
  return new EncryptedBackend(inner, k);
}
