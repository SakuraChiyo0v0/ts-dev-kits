// 职责分类用于导航；它不改变目录、包名或发布顺序。
export const PACKAGE_GROUPS = [
  { id: "foundation", title: "通用基础", packages: ["logger", "cli-utils"] },
  { id: "storage", title: "存储与配置", packages: ["config", "config-webdav", "config-pg", "webdav", "database"] },
  { id: "auth", title: "账号认证", packages: ["account"] },
  { id: "utilities", title: "媒体与通用工具", packages: ["ffmpeg", "media-downloader", "chuanshengtong", "email"] },
  { id: "platforms", title: "平台 SDK", packages: ["bilibili", "netease-music", "booth", "steam", "vrchat", "xiaoheihe", "lol", "ugreen", "chat-platforms", "kazumi"] },
];
const groupOf = new Map(PACKAGE_GROUPS.flatMap(g => g.packages.map(p => [p, g.id])));
const allowedGroups = {
  foundation: ["foundation"],
  storage: ["foundation", "storage"],
  auth: ["foundation"],
  utilities: ["foundation", "utilities"],
  platforms: ["foundation", "storage", "auth", "utilities"],
};
// 核心和适配器处于同一导航分类，但依赖方向必须更严格。
const allowedPackages = {
  logger: [],
  "cli-utils": ["logger"],
  config: ["logger"],
  webdav: ["logger", "cli-utils"],
  "config-pg": ["config", "logger"],
  "config-webdav": ["config", "webdav", "logger", "cli-utils"],
  account: ["logger"],
};

export function assertPackageLayer(manifest) {
  const short = manifest.name.replace(/^@sakurachiyo0v0\//u, "");
  const group = groupOf.get(short);
  if (!group) throw new Error(`工具包未分类: ${manifest.name}`);
  // 开发依赖允许跨层，用于真实适配器集成测试。
  for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
    if (!dependency.startsWith("@sakurachiyo0v0/")) continue;
    const target = dependency.slice("@sakurachiyo0v0/".length);
    const targetGroup = groupOf.get(target);
    if (!targetGroup) throw new Error(`依赖工具包未分类: ${dependency}`);
    const allowed = allowedPackages[short]?.includes(target) ?? allowedGroups[group].includes(targetGroup);
    if (target === short || !allowed) throw new Error(`依赖方向越界: ${short} -> ${target}`);
  }
}
