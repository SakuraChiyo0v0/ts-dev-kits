/**
 * 发布包清单(唯一权威)—— publish-packages.mjs 与 check-dependency-chain.mjs 共用。
 *
 * 顺序即发布顺序:依赖图单向无环,被依赖者先发布。
 * 新增包时必须在此追加(漏了会导致包永远不会发布到 GitHub Packages)。
 */
export const PACKAGES = [
  ["@sakurachiyo0v0/logger", "packages/logger"],
  ["@sakurachiyo0v0/cli-utils", "packages/cli-utils"],
  ["@sakurachiyo0v0/chuanshengtong", "packages/chuanshengtong"],
  ["@sakurachiyo0v0/webdav", "packages/webdav"],
  ["@sakurachiyo0v0/config", "packages/config"],
  ["@sakurachiyo0v0/account", "packages/account"],
  ["@sakurachiyo0v0/email", "packages/email"],
  ["@sakurachiyo0v0/ffmpeg", "packages/ffmpeg"],
  ["@sakurachiyo0v0/kazumi", "packages/kazumi"],
  ["@sakurachiyo0v0/lol", "packages/lol"],
  ["@sakurachiyo0v0/netease-music", "packages/netease-music"],
  ["@sakurachiyo0v0/booth", "packages/booth"],
  ["@sakurachiyo0v0/bilibili", "packages/bilibili"],
  ["@sakurachiyo0v0/chat-platforms", "packages/chat-platforms"],
  ["@sakurachiyo0v0/vrchat", "packages/vrchat"],
  ["@sakurachiyo0v0/steam", "packages/steam"],
  ["@sakurachiyo0v0/xiaoheihe", "packages/xiaoheihe"],
  ["@sakurachiyo0v0/database", "packages/database"],
  ["@sakurachiyo0v0/dsh-sdk-tools", "packages/dsh-sdk-tools"],
];
