/** 配置存储后端抽象：底层存储可插拔（WebDAV / PostgreSQL / ...），加密由包装器负责。 */

/** 后端接口：原始键值存取，key 由调用方拼接前缀保证分域。 */
export interface ConfigBackend {
  /** 读取原始值（存储层返回的类型由后端决定，text/json 皆可）。 */
  load<T = unknown>(key: string): Promise<T>;
  /** 写入原始值。 */
  save(key: string, value: unknown): Promise<void>;
  /** 列出该后端下所有键。 */
  list(): Promise<string[]>;
  /** 删除一个键。 */
  remove(key: string): Promise<void>;
  /** 派生带前缀的子后端（同一存储分域隔离）。 */
  withPrefix(prefix: string): ConfigBackend;
}

/** 前缀包装：给所有键加前缀，实现分域。 */
export class PrefixBackend implements ConfigBackend {
  readonly #inner: ConfigBackend;
  readonly #prefix: string;

  constructor(inner: ConfigBackend, prefix: string) {
    this.#inner = inner;
    this.#prefix = prefix;
  }

  load<T = unknown>(key: string): Promise<T> {
    return this.#inner.load<T>(`${this.#prefix}:${key}`);
  }

  save(key: string, value: unknown): Promise<void> {
    return this.#inner.save(`${this.#prefix}:${key}`, value);
  }

  list(): Promise<string[]> {
    return this.#inner.list().then((keys) =>
      keys
        .filter((k) => k.startsWith(`${this.#prefix}:`))
        .map((k) => k.slice(this.#prefix.length + 1)),
    );
  }

  remove(key: string): Promise<void> {
    return this.#inner.remove(`${this.#prefix}:${key}`);
  }

  withPrefix(prefix: string): ConfigBackend {
    return new PrefixBackend(this.#inner, `${this.#prefix}:${prefix}`);
  }
}

/** 便捷工厂：给后端包一层前缀。 */
export function prefixBackend(inner: ConfigBackend, prefix: string): ConfigBackend {
  return new PrefixBackend(inner, prefix);
}

/**
 * 明文 JSON 包装：底层后端按「字符串透明」约定（只存/读字符串），
 * 此包装负责明文域的 JSON.stringify / JSON.parse。
 * 加密域用 EncryptedBackend（密文字符串），两者统一上层的 JSON 处理。
 */
export class JsonBackend implements ConfigBackend {
  readonly #inner: ConfigBackend;

  constructor(inner: ConfigBackend) {
    this.#inner = inner;
  }

  async load<T = unknown>(key: string): Promise<T> {
    const raw = await this.#inner.load<string>(key);
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  save(key: string, value: unknown): Promise<void> {
    return this.#inner.save(key, JSON.stringify(value));
  }

  list(): Promise<string[]> {
    return this.#inner.list();
  }

  remove(key: string): Promise<void> {
    return this.#inner.remove(key);
  }

  withPrefix(prefix: string): ConfigBackend {
    return new JsonBackend(this.#inner.withPrefix(prefix));
  }
}
