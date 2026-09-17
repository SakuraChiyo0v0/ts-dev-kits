export {
  createConfigCenter,
  initConfig,
  config,
  resetConfig,
} from "./config-center.js";
export { resolveConfigRoot } from "./paths.js";
export { ConfigError, type ConfigErrorCode } from "./errors.js";
export { PrefixBackend, prefixBackend, JsonBackend, type ConfigBackend } from "./backend.js";
export { EncryptedBackend, encryptedBackend, deriveKey } from "./encrypt.js";
export type {
  ConfigCenter,
  ConfigCenterOptions,
  ConfigNamespace,
  NamespaceOptions,
} from "./types.js";
