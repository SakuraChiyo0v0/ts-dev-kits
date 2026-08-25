/**
 * 客户端工厂 —— createXiaoheiheClient。
 * 登录态经 @sakurachiyo0v0/account 的 AuthStore 持久化(默认 <配置根>/amechan/xiaoheihe/auth.json);
 * 显式 cookie 优先,否则自动从 AuthStore 加载。
 */
import { AuthStore } from "@sakurachiyo0v0/account";
import { XiaoheiheError } from "./errors.js";
import { XiaoheiheHttpTransport, type XiaoheiheFetch } from "./transport.js";
import { LinksApi } from "./api/links.js";
import { FeedsApi } from "./api/feeds.js";
import { MessagesApi } from "./api/messages.js";
import { UserApi } from "./api/user.js";
import type { ConfigNamespace } from "@sakurachiyo0v0/config";
import type { XiaoheiheCredentials } from "./types.js";

export interface XiaoheiheClientOptions {
  /** 显式 cookie 头(优先于 AuthStore)。 */
  cookie?: string;
  /** 登录态存储路径(覆盖默认 <配置根>/amechan/xiaoheihe/auth.json)。 */
  authPath?: string;
  /**
   * 可选远程登录态命名空间(配置中心加密域,如 createConfigCenter().namespace("auth",{encrypt:true}))。
   * 登录态双写本地+远程;新机还原:先 await new AuthStore({platform:"xiaoheihe",remote}).load()。
   */
  remote?: ConfigNamespace;
  /** 覆盖 base URL(测试 mock 用)。 */
  baseUrl?: string;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: XiaoheiheFetch;
  /** device_id 公共参数。 */
  deviceId?: string;
  /** version 公共参数。 */
  version?: string;
  /** web_version 公共参数。 */
  webVersion?: string;
  /** 请求超时(毫秒)。 */
  timeoutMs?: number;
  /** 脱敏请求日志。 */
  logger?: (line: string) => void;
}

/** 小黑盒客户端。 */
export interface XiaoheiheClient {
  /** 帖子与评论查询。 */
  links: LinksApi;
  /** 首页帖子流。 */
  feeds: FeedsApi;
  /** @消息。 */
  messages: MessagesApi;
  /** 用户资料。 */
  user: UserApi;
  /** 登录态管理。 */
  auth: {
    /** 当前登录态 cookie(未登录返回 undefined)。 */
    cookie: string | undefined;
    /** 登录态是否存在(有 cookie 即视为已登录)。 */
    isLoggedIn(): boolean;
    /** 校验登录态:尝试读取一条 @消息,失败抛 AUTH_EXPIRED/LOGIN_REQUIRED。 */
    status(): Promise<{ loggedIn: boolean; heyboxId?: string; time?: number }>;
    /** 清除本地登录态与内存 cookie。 */
    logout(): Promise<void>;
  };
  /** 关闭传输层(释放资源;当前无外部连接,幂等)。 */
  close(): Promise<void>;
}

/** 创建小黑盒客户端。 */
export function createXiaoheiheClient(options: XiaoheiheClientOptions = {}): XiaoheiheClient {
  const transport = new XiaoheiheHttpTransport({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.deviceId !== undefined ? { deviceId: options.deviceId } : {}),
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.webVersion !== undefined ? { webVersion: options.webVersion } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });

  // 显式 cookie 优先,否则从 AuthStore 加载。
  let store: AuthStore | undefined;
  let loadedCredentials: XiaoheiheCredentials | undefined;
  if (options.cookie !== undefined && options.cookie !== "") {
    transport.setCookie(options.cookie);
  } else {
    store = new AuthStore({
      platform: "xiaoheihe",
      ...(options.authPath !== undefined ? { path: options.authPath } : {}),
      ...(options.remote !== undefined ? { remote: options.remote } : {}),
    });
    const payload = store.loadSync();
    if (payload !== null) {
      const creds = payload.credentials as Partial<XiaoheiheCredentials> | undefined;
      if (
        creds !== undefined &&
        typeof creds.cookie === "string" &&
        creds.cookie !== "" &&
        typeof creds.heyboxId === "string" &&
        typeof creds.time === "number"
      ) {
        loadedCredentials = { cookie: creds.cookie, heyboxId: creds.heyboxId, time: creds.time };
        transport.setCookie(loadedCredentials.cookie);
      }
    }
  }

  const links = new LinksApi(transport);
  const feeds = new FeedsApi(transport);
  const messages = new MessagesApi(transport);
  const user = new UserApi(transport);

  return {
    links,
    feeds,
    messages,
    user,
    auth: {
      get cookie() {
        return transport.cookie;
      },
      isLoggedIn() {
        return transport.cookie !== undefined && transport.cookie !== "";
      },
      async status() {
        if (!transport.cookie) {
          throw new XiaoheiheError("LOGIN_REQUIRED", "未登录,请先扫码登录");
        }
        // 用一条 @消息请求校验登录态(401 → AUTH_EXPIRED)。
        await messages.listAt({ limit: 1 });
        return {
          loggedIn: true,
          ...(loadedCredentials !== undefined ? { heyboxId: loadedCredentials.heyboxId } : {}),
          ...(loadedCredentials !== undefined ? { time: loadedCredentials.time } : {}),
        };
      },
      async logout() {
        transport.clearCookie();
        if (store !== undefined) {
          await store.clear();
        }
      },
    },
    async close() {
      transport.clearCookie();
    },
  };
}
