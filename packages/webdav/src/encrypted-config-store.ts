import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createLogger } from "@sakurachiyo0v0/logger";
import { createConfigStore } from "./config-store.js";
import { WebdavError, WebdavErrorCode } from "./errors.js";
import type { ConfigStore, ConfigStoreOptions, WebdavClient } from "./types.js";

const logger = createLogger({ namespace: "webdav" }).child("encrypted-config-store");

/** 加密密钥的环境变量名(优先于 options.key 之外的兜底) */
export const ENCRYPTION_KEY_ENV = "WEBDAV_CONFIG_KEY";

/** 加密配置存储选项:在 ConfigStore 基础上增加密钥 */
export interface EncryptedConfigStoreOptions extends ConfigStoreOptions {
  /**
   * 加密密钥(必填其一):
   * - 32 字节 hex(64 字符)/base64(44 字符) 直接作为 AES-256 密钥;
   * - 任意字符串自动用 SHA-256 派生为 32 字节密钥;
   * - 缺省读环境变量 `WEBDAV_CONFIG_KEY`。
   */
  key?: string;
}

/** 把用户提供的密钥统一派生为 32 字节 AES-256 密钥 */
function deriveKey(key: string): Buffer {
  if (key.length === 64 && /^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, "hex");
  if (key.length === 44) {
    const decoded = Buffer.from(key, "base64");
    if (decoded.length === 32) return decoded;
  }
  return createHash("sha256").update(key, "utf8").digest();
}

/**
 * 加密配置存储:save 前 AES-256-GCM 加密、load 时解密。
 * 云端(WebDAV)只存密文(JSON:{v,iv,tag,data}),密钥只存在于本地,
 * 即使 WebDAV 账号/传输被泄露,没有密钥也无法还原明文。
 */
export class EncryptedConfigStoreImpl implements ConfigStore {
  private readonly inner: ConfigStore;
  private readonly key: Buffer;

  constructor(client: WebdavClient, options: EncryptedConfigStoreOptions = {}) {
    const key = options.key ?? process.env[ENCRYPTION_KEY_ENV];
    if (key === undefined || key.length === 0) {
      throw new WebdavError(
        WebdavErrorCode.VALIDATION,
        `缺少加密密钥:传 key 或设置环境变量 ${ENCRYPTION_KEY_ENV}`,
      );
    }
    this.key = deriveKey(key);
    // 内部用 text 格式存密文字符串(不二次 JSON 解析);原子写/备份复用 ConfigStore
    this.inner = createConfigStore({
      client,
      ...(options.basePath !== undefined ? { basePath: options.basePath } : {}),
      format: "text",
      ...(options.backupCount !== undefined ? { backupCount: options.backupCount } : {}),
    });
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    });
  }

  private decrypt(payload: string): string {
    let parsed: { v?: unknown; iv?: string; tag?: string; data?: string };
    try {
      parsed = JSON.parse(payload) as typeof parsed;
    } catch (err) {
      throw new WebdavError(WebdavErrorCode.UNKNOWN, "密文格式非法(不是合法 JSON)", err);
    }
    if (parsed.v !== 1 || parsed.iv === undefined || parsed.tag === undefined || parsed.data === undefined) {
      throw new WebdavError(WebdavErrorCode.UNKNOWN, "密文格式非法(缺少 iv/tag/data)");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(parsed.iv, "base64"));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString("utf8");
    } catch (err) {
      logger.error("decryption failed", {
        code: WebdavErrorCode.DECRYPTION,
        hint: "key mismatch or corrupted data",
        error: err,
      });
      throw new WebdavError(WebdavErrorCode.DECRYPTION, "解密失败(密钥错误或数据损坏)", err);
    }
  }

  async load<T = unknown>(name: string): Promise<T> {
    const ciphertext = await this.inner.load<string>(name);
    const plain = this.decrypt(ciphertext);
    try {
      return JSON.parse(plain) as T;
    } catch (err) {
      logger.error("decrypted content is not valid json", { name, error: err });
      throw new WebdavError(WebdavErrorCode.UNKNOWN, "解密内容不是合法 JSON", err);
    }
  }

  async save(name: string, data: unknown): Promise<void> {
    const plain = JSON.stringify(data);
    await this.inner.save(name, this.encrypt(plain));
    logger.info("encrypted config saved", { name });
  }

  async list(): Promise<string[]> {
    return this.inner.list();
  }

  async remove(name: string): Promise<void> {
    return this.inner.remove(name);
  }
}

/** 创建加密配置存储 */
export function createEncryptedConfigStore(
  options: { client: WebdavClient } & EncryptedConfigStoreOptions,
): ConfigStore {
  return new EncryptedConfigStoreImpl(options.client, options);
}
