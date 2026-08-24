export { AccountError, toAccountError, type AccountErrorCode } from "./errors.js";
export {
  resolveConfigRoot,
  defaultAuthPath,
} from "./paths.js";
export {
  AuthStore,
  type AuthPayload,
  type AuthStoreOptions,
} from "./store.js";
export {
  qrcodeLogin,
  openBrowserDefault,
  isTerminalState,
} from "./qr-flow.js";
export type {
  PlatformCredentials,
  LoginResult,
  LoginState,
  LoginStatus,
  QrLoginAdapter,
  QrLoginOptions,
} from "./types.js";

// 密码登录骨架(追加,不修改现有导出)
export { passwordLogin } from "./password-flow.js";
export type {
  PasswordLoginAdapter,
  PasswordLoginOptions,
  PasswordLoginStep,
} from "./password-flow.js";

// 浏览器登录骨架(追加,不修改现有导出)
export { browserLogin, detectBrowser, defaultBrowserProfileDir } from "./browser-flow.js";
export type {
  BrowserLoginAdapter,
  BrowserLoginOptions,
} from "./browser-flow.js";
