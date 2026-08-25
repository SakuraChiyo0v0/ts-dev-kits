/**
 * 平台适配器契约与登录骨架类型。
 * account 只感知骨架,不感知具体平台;登录方法(生成/轮询/凭证序列化)由平台包实现。
 */
import type { AuthPayload, AuthStore } from "./store.js";

/** 平台凭证(登录成功后由平台适配器产出)。 */
export type PlatformCredentials = Record<string, unknown>;

/** 扫码状态。 */
export type LoginState = "waiting" | "scanned" | "success" | "expired" | "timeout" | "failed";

export interface LoginStatus {
  state: LoginState;
  message: string;
}

export interface LoginResult {
  /** 平台凭证(如网易云 cookie 对象 / B 站 cookie 字符串 + refresh_token)。 */
  credentials: PlatformCredentials;
  /** 是否已持久化到 AuthStore(传了 store 时为 true)。 */
  saved: boolean;
}

/** 平台扫码登录适配器(平台包实现)。 */
export interface QrLoginAdapter {
  /** 平台名,如 "netease-music",决定 AuthStore 默认路径。 */
  readonly platform: string;
  /** 生成二维码,返回 key 与完整扫码 URL。 */
  generateKey(fetchImpl: typeof fetch): Promise<{ key: string; url: string }>;
  /** 轮询扫码状态;成功时返回平台凭证。 */
  pollStatus(
    key: string,
    fetchImpl: typeof fetch,
  ): Promise<{
    state: "waiting" | "scanned" | "success" | "expired";
    message: string;
    credentials?: PlatformCredentials;
  }>;
  /** 可选:登录态续期(如 B 站 refresh_token 换新 cookie);无续期机制的平台省略。 */
  refresh?(credentials: PlatformCredentials, fetchImpl: typeof fetch): Promise<PlatformCredentials>;
  /** 凭证序列化为 AuthPayload(平台专属字段收进 credentials)。 */
  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload;
  /** 从 AuthPayload 反序列化凭证;不匹配/损坏返回 null。 */
  deserialize(payload: AuthPayload): PlatformCredentials | null;
}

/** 扫码登录选项。 */
export interface QrLoginOptions {
  /** 平台适配器(必填)。 */
  adapter: QrLoginAdapter;
  /** 登录态存储;不传则不持久化(仅返回凭证)。 */
  store?: AuthStore;
  /** 轮询间隔(毫秒),默认 2000。 */
  pollIntervalMs?: number;
  /** 总超时(毫秒),默认 180000(3 分钟)。 */
  timeoutMs?: number;
  /** 二维码过期后重新生成的最大次数,默认 3。 */
  maxRegenerates?: number;
  /** 自定义浏览器打开器(便于测试);缺省用平台默认命令。 */
  openBrowser?: (url: string) => void | Promise<void>;
  /** 是否自动打开浏览器,默认 true。 */
  autoOpenBrowser?: boolean;
  /** 每次生成/重生成二维码时回调图片 data URL(供远程/聊天渠道展示给用户扫码)。 */
  onQrCode?: (qrDataUrl: string) => void;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 进度回调(测试/UI 用)。 */
  onStatus?: (status: LoginStatus) => void;
}
