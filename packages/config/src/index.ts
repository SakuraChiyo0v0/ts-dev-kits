export { createConfigCenter } from "./config-center.js";
export {
  saveGlobalConfig,
  loadGlobalConfig,
  clearGlobalConfig,
  resolveConfigPath,
  resolveConfigRoot,
} from "./global-config.js";
export { PrefixBackend, prefixBackend, JsonBackend, type ConfigBackend } from "./backend.js";
export { EncryptedBackend, encryptedBackend, deriveKey } from "./encrypt.js";
export { PgBackend } from "./pg-backend.js";
export type {
  ConfigCenter,
  ConfigCenterOptions,
  ConfigNamespace,
  GlobalConfig,
  NamespaceOptions,
} from "./types.js";
