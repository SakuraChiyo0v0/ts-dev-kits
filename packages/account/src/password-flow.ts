/**
 * 密码登录骨架 —— 提交用户名密码,若平台要求 2FA 则通过 onNeedCode 回调取验证码,
 * 成功后通过平台适配器收集凭证并落盘。
 *
 * 与 qr-flow.ts 的 qrcodeLogin 平行:平台差异全部收敛在 PasswordLoginAdapter
 * (login / verifyCode / serialize / deserialize),本文件不感知具体平台。
 * 所有新类型定义在本文件内,不写入 types.ts(与 Booth 开发零交集)。
 */
import { AccountError, toAccountError } from "./errors.js";
import type { AuthPayload, AuthStore } from "./store.js";
import type { LoginResult, PlatformCredentials } from "./types.js";

/** 登录步骤:成功(含凭证)或需要 2FA 验证码。 */
export type PasswordLoginStep =
  | { status: "success"; credentials: PlatformCredentials }
  | {
      status: "need_code";
      /** 平台给出的验证挑战标识(骨架不感知具体内容)。 */
      challengeId: string;
      /** 验证方式,如 "otp" / "totp";IDE 对字面量有提示。 */
      method: "otp" | "totp" | (string & {});
      message: string;
    };

/** 平台密码登录适配器(平台包实现)。 */
export interface PasswordLoginAdapter {
  /** 平台名,如 "vrchat",决定 AuthStore 默认路径。 */
  readonly platform: string;
  /** 提交用户名密码;返回下一步(成功或需要 2FA 验证)。 */
  login(
    credentials: { username: string; password: string },
    fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep>;
  /** 提交 2FA 验证码;成功返回凭证,失败可返回新的 need_code(重试)。 */
  verifyCode(
    step: { challengeId: string; method: string },
    code: string,
    fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep>;
  /** 可选:登录态续期;无续期机制的平台省略。 */
  refresh?(credentials: PlatformCredentials, fetchImpl: typeof fetch): Promise<PlatformCredentials>;
  /** 凭证序列化/反序列化(与 QrLoginAdapter 相同)。 */
  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload;
  deserialize(payload: AuthPayload): PlatformCredentials | null;
}

/** 密码登录选项。 */
export interface PasswordLoginOptions {
  /** 平台适配器(必填)。 */
  adapter: PasswordLoginAdapter;
  /** 用户名。 */
  username: string;
  /** 密码。 */
  password: string;
  /** 需要 2FA 时取验证码的回调(CLI 从 stdin 读 / 程序注入)。 */
  onNeedCode?: (
    info: { method: string; message: string; attempt: number },
  ) => Promise<string> | string;
  /** 登录态存储;不传则不持久化(仅返回凭证)。 */
  store?: AuthStore;
  /** 最大验证码重试次数,默认 3。 */
  maxCodeAttempts?: number;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 进度回调(测试/UI 用)。state: submitting | need_code | success | failed。 */
  onStatus?: (status: { state: string; message: string }) => void;
}

/**
 * 执行密码登录:提交用户名密码 → 若需 2FA 循环取码验证 → 成功后可持久化。
 * 用户取消(取码返回空字符串)抛 TWO_FACTOR_FAILED;无取码途径抛 TWO_FACTOR_REQUIRED。
 */
export async function passwordLogin(options: PasswordLoginOptions): Promise<LoginResult> {
  const { adapter, username, password, store } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxCodeAttempts = options.maxCodeAttempts ?? 3;
  const emit = (state: string, message: string): void => {
    options.onStatus?.({ state, message });
  };

  emit("submitting", `正在登录 ${adapter.platform} ...`);
  let step: PasswordLoginStep;
  try {
    step = await adapter.login({ username, password }, fetchImpl);
  } catch (error) {
    throw toAccountError(error, "登录失败");
  }

  if (step.status === "success") {
    return finish(adapter, step.credentials, store, emit);
  }

  // need_code:循环取码验证。
  if (options.onNeedCode === undefined) {
    throw new AccountError(
      "TWO_FACTOR_REQUIRED",
      `需要 2FA 验证(${step.method}),但未提供 onNeedCode 回调`,
    );
  }

  for (let attempt = 1; attempt <= maxCodeAttempts; attempt += 1) {
    emit("need_code", step.message);
    let code: string;
    try {
      const value = await options.onNeedCode({
        method: step.method,
        message: step.message,
        attempt,
      });
      code = String(value ?? "").trim();
    } catch (error) {
      throw toAccountError(error, "获取验证码失败");
    }
    if (code === "") {
      throw new AccountError("TWO_FACTOR_FAILED", "验证码输入为空,登录已取消");
    }
    try {
      step = await adapter.verifyCode(
        { challengeId: step.challengeId, method: step.method },
        code,
        fetchImpl,
      );
    } catch (error) {
      throw toAccountError(error, "验证 2FA 失败");
    }
    if (step.status === "success") {
      return finish(adapter, step.credentials, store, emit);
    }
    // 仍为 need_code(验证码错误或平台要求重新验证),继续下一轮。
  }

  throw new AccountError("TWO_FACTOR_FAILED", `2FA 验证失败(超过 ${maxCodeAttempts} 次尝试)`);
}

/** 登录成功收尾:可选持久化 + 进度通知。 */
async function finish(
  adapter: PasswordLoginAdapter,
  credentials: PlatformCredentials,
  store: AuthStore | undefined,
  emit: (state: string, message: string) => void,
): Promise<LoginResult> {
  emit("success", "登录成功");
  if (store !== undefined) {
    const payload = adapter.serialize(credentials, new Date().toISOString());
    await store.save(payload);
  }
  return { credentials, saved: store !== undefined };
}
