# Web 应用平台与统一认证装配设计

状态: 用户已批准
日期: 2026-08-28

## 1. 当前问题与目标

### 现状

- 仓库 `packages/*` 已沉淀完整 SDK（`config` / `account` / `webdav` / `bilibili` / `netease-music` / `steam` / `vrchat` / `booth` / `xiaoheihe` / `kazumi` / `ffmpeg` / `database` / `logger` 等），但消费形态都是 **CLI / 服务端进程**，没有 Web 应用承载层。
- 各平台登录态、配置的"多端同步"能力**已由 SDK 内置**，但缺乏一个统一的 Web 应用骨架把这些能力接起来：
  - `@sakurachiyo0v0/account` 的 `AuthStore` 已实现「本地 + 远程(WebDAV)双写」；
  - `@sakurachiyo0v0/config` 的 `createConfigCenter({ global })` 支持显式传入配置（不读本地文件），适配 Docker 环境变量注入。
- 用户后续要部署"很多项目"，目标环境是**标准 Docker 服务器**（非 NAS 专属），形态不止 Web，还可能有单一后台应用 / 桌面端。

### 目标

在 `apps/*` 目录下建立一套**可 Docker 部署的 Web 应用标准骨架**（Hono + React + Tailwind + Vite），并确立**统一认证装配机制**：

> 每个 app 只需注入 3~4 个环境变量，启动后自动直连 WebDAV，拉取/写回各平台登录态，实现「一次登录、全局配好」——不再让每个 app 单独配 cookie / 连接串。

本阶段范围：

1. 落成本方案（本文档）。
2. 搭建统一应用骨架（目录结构 + bootstrap 装配 + Hono RPC + 静态托管）。
3. 落地第一个**轻量 demo**（单平台账号面板，见 §8），端到端跑通「骨架 → 装配 → 扫码登录闭环 → WebDAV 双写」。

后续阶段（不在本阶段）：

- `media-downloader` 等重业务 app（下载长任务 / 进度推送 / ffmpeg 合并）。
- 桌面端 / 单一后台 Worker 等非 Web 形态（复用同一套装配机制）。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 新起一个 Web 项目要自己搭前后端、自己处理登录态与 WebDAV 同步 | 复用 `apps/` 骨架 + 3~4 个环境变量，登录态自动从 WebDAV 装配 |
| 每个 app 单独配 cookie / token | 任一 app 扫码登录一次，写入 WebDAV，其他 app 自动读到 |
| 前端调用后端要手写接口类型 | Hono RPC（`hc`）端到端类型安全 |
| 下载/转码等长任务无统一进度通道 | SSE 统一进度推送（本阶段仅规划，重业务 app 落地时用） |

## 3. 方案选择

### 方案 A：各 app 直连 WebDAV（采用）

```
Docker 环境变量注入(每 app 3~4 个):
  WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD / WEBDAV_CONFIG_KEY
        │
        ▼
apps/<app>/server/bootstrap.ts
  └─ createConfigCenter({ global: { url, username, password, key } })
       └─ namespace("auth", { encrypt: true })   ← 统一 remote 命名空间
            └─ 传给各平台 SDK client 的 remote 参数
        │
        ▼
WebDAV /amechan/secrets/auth/<platform>   ← 唯一事实源
```

- **优点**：与现有 SDK 完全契合（`AuthStore.remote`、`createConfigCenter({ global })` 就是为此设计），无额外运行时依赖、无单点；部署极简（环境变量即可）。
- **代价**：每个 app 都要跑一段相同的 bootstrap 装配逻辑（用骨架复用消除）；WebDAV 本身的可用性成为各 app 的前提（可接受，WebDAV 已有超时降级本地机制）。

### 方案 B：中央 Auth/Config 网关（不采用）

- 形态：常驻一个 `auth-hub` 服务，其他 app 通过 HTTP 向它索取 token。
- **优点**：token 集中管理、可做统一续期。
- **缺点**：与 SDK 的「直连 WebDAV」模型相悖，需要新写一套「网关 → token 分发」协议（SDK 不支持）；引入额外单点，网关挂了全挂；违背仓库「不过度设计」原则。**否掉**。

### 方案 C：每 app 独立本地配置（不采用）

- 形态：每个 app 各自保存本地 cookie / 配置，不做同步。
- **优点**：最简单。
- **缺点**：回到「每个 app 单独配」的老路，与「一次登录全局配好」目标直接冲突。**否掉**。

## 4. 仓库结构

```text
ts-dev-kits/
├─ packages/                  # 纯 SDK（现有，不动）
├─ apps/                      # 新增：业务落地应用（每个独立 Docker 容器）
│  ├─ account-panel/          # 第一个轻量 demo（本阶段）
│  │  ├─ package.json         # 依赖 workspace:* 的 SDK
│  │  ├─ Dockerfile           # 多阶段：build client → build server → 极简 Node 运行时
│  │  ├─ vite.config.ts
│  │  ├─ src/
│  │  │  ├─ server/
│  │  │  │  ├─ index.ts       # 入口：静态托管 + API 路由 + SSE
│  │  │  │  ├─ bootstrap.ts   # 环境变量 → ConfigCenter → remote 装配
│  │  │  │  ├─ auth-sessions.ts  # 扫码登录会话表（内存）
│  │  │  │  └─ routes/        # 业务路由（登录状态 / 扫码 / 查询）
│  │  │  └─ client/
│  │  │     ├─ index.html
│  │  │     └─ src/           # React + Tailwind，lib/rpc.ts 用 hc 接后端
│  │  └─ tsconfig.json
│  └─ ...                     # 后续：media-downloader 等
└─ pnpm-workspace.yaml        # packages 增加 'apps/*'
```

## 5. 统一认证装配机制（bootstrap）

### 5.1 环境变量 → GlobalConfig

`apps/*` 的 `bootstrap.ts` 统一做一次映射，**不依赖本地 `config.json`，也不在容器里跑 `sc-config setup`**：

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";

export function createAppCenter() {
  return createConfigCenter({
    global: {
      url: env("WEBDAV_URL"),
      ...(process.env.WEBDAV_USERNAME ? { username: process.env.WEBDAV_USERNAME } : {}),
      ...(process.env.WEBDAV_PASSWORD ? { password: process.env.WEBDAV_PASSWORD } : {}),
      ...(process.env.WEBDAV_CONFIG_KEY ? { key: process.env.WEBDAV_CONFIG_KEY } : {}),
    },
  });
}

// 统一登录态远程命名空间（所有平台共用这一个）
export function createAuthNamespace() {
  return createAppCenter().namespace("auth", { encrypt: true });
}
```

关键事实（源码级，勿改动语义）：

- 加密密钥：`global.key` 或环境变量 `WEBDAV_CONFIG_KEY`（`EncryptedConfigStore` 内部兜底读它）。
- 加密域路径：`/amechan/secrets/auth`，key 是平台名（`AuthStore.save` 用 `this.#platform`）。
- 登录态双写：`AuthStore.load()` 优先远程、失败/超时降级本地（5000ms）、远程成功回写本地缓存。

### 5.2 给各平台 SDK 传 remote

各平台 client 均已支持 `remote` 参数（`bilibili` / `netease-music` / `steam` / `vrchat` / `booth` / `xiaoheihe`）：

```ts
import { createNeteaseClient } from "@sakurachiyo0v0/netease-music";

const authNs = createAuthNamespace();
const client = createNeteaseClient({ remote: authNs });
// 未登录时 client 内部自动从 AuthStore(远程优先) 加载;
// netease 无静默续期,MUSIC_U 过期后需重新扫码;
// bilibili 等带 refresh_token 的平台会在失效时自动续期并写回(双写远程)。
```

### 5.3 容器本地缓存无需持久化

`AuthStore` 会写本地 `auth.json` 缓存，但 **WebDAV 是唯一事实源**。容器重启本地丢失无妨，冷启动多一次远程读。**不为 auth.json 挂卷**（简化部署，避免容器间缓存不一致）。

## 6. 登录会话表（扫码闭环，本阶段落地）

现有 `QrLoginAdapter`（`generateKey` / `pollStatus` / `onQrCode`）是服务端进程形态，落到 Web 上需补一层**服务端登录会话**，让前端刷新后能恢复。

设计（内存即可，单实例；多实例需换 Redis，后续再说）：

```ts
interface AuthSession {
  id: string;            // 会话 id（前端保存，刷新恢复）
  platform: string;      // 如 "netease-music"
  state: LoginState;     // waiting | scanned | success | expired | timeout | failed
  qrDataUrl?: string;    // 二维码图片，经 SSE 推给前端
  message?: string;
}
```

流程：

1. 前端 `POST /api/auth/:platform/start` → 后端创建会话，调用 adapter.generateKey，SSE 推二维码。
2. 后端轮询 `pollStatus`，状态变化经 SSE 推给前端。
3. 扫码成功 → 后端 `new AuthStore({ platform, remote }).save(serialize(...))`（自动双写 WebDAV）→ 前端刷新登录态。
4. 前端刷新页面后凭 sessionId `GET /api/auth/session/:id` 恢复当前状态。

## 7. 平台健康检查适配表（后续阶段）

各平台 refresh 能力不一，需要一张适配表统一「判断是否过期 / 能否静默续期」：

| 平台 | 过期判断 | 静默续期 | 备注 |
| --- | --- | --- | --- |
| netease-music | 接口报错（登录态失效） | ❌（需重新扫码） | 本阶段落地；MUSIC_U 长期有效，过期需重扫 |
| bilibili | 接口 -101 | ✅ refresh_token | 已内置 `onAuthFailure` |
| steam | 需确认 | ❌ | 登录态较稳定 |
| vrchat / booth / xiaoheihe | 需确认 | ❌ | 待核对 |

本阶段只落地 netease-music 一列；其余平台在接入对应 app 时逐列补全。

## 8. 第一个轻量 demo：`apps/account-panel`

聚焦**单个平台（netease-music 网易云）**，验证最小闭环，不做下载长任务。

**功能范围：**

1. 登录状态展示：从 WebDAV 读取网易云登录态，前端显示「已登录 / 未登录」。
2. 扫码登录：点击登录 → SSE 推二维码 → 手机网易云 App 扫码确认 → 后端轮询成功 → 双写 WebDAV → 前端刷新为已登录。
3. 基础查询：登录后调用网易云账号信息接口，展示昵称/头像/签名，并拉取歌单列表（验证「SDK 消费」链路）。

**刻意不做（留到 media-downloader）：**

- 下载 / 转码 / 长任务队列 / 进度推送。
- 多平台接入。

**验收口径：**

- 两个 app 实例（或同 app 两次启动）共享同一 WebDAV，其一扫码登录后，另一个能读到登录态（验证「一次登录全局配好」）。

## 9. 技术选型细节

- **后端**：Hono（`@hono/node-server`），`serveStatic` 托管 `dist/client`，`@hono/streaming` 或原生 `streamSSE` 做 SSE。冷启动快、内存小。
- **前端**：React 18 + Vite + Tailwind CSS；用 `hono/client` 的 `hc<AppType>()` 获得端到端类型安全。
- **构建**：单容器多阶段（client 产物 → server 产物 → 极简 node 运行时），`CMD` 起 Hono 服务，单端口同时提供 `/api` + 静态页。
- **无状态**：app 本身不存业务状态（登录态在 WebDAV，会话表内存可重建），天然适配容器水平扩展。

## 10. 安全红线

- `WEBDAV_CONFIG_KEY` 是**唯一不可丢失**的密钥：丢了它，WebDAV 上所有加密登录态/配置永久无法解密。必须在设计/文档中把备份策略作为一等公民（如离线抄写、多设备保存）。
- 凭据只经 `AuthStore`（本地 600 权限 + 远程 AES-256-GCM 密文）流转，**不落明文日志、不出现在前端 JS 包**。前端只拿「是否登录 + 脱敏用户信息」，绝不回传完整 cookie。
- 环境变量注入的 WebDAV 密码不写进镜像层，仅经 `docker run -e` / compose secrets 传入。

## 11. 验收条件

- [x] 本文档获用户批准（状态改为「用户已批准」）
- [x] `pnpm-workspace.yaml` 增加 `apps/*`，根 `pnpm install` 通过
- [x] `apps/account-panel` 骨架可运行：`pnpm dev` 起 Hono + Vite，浏览器打开页面
- [x] 环境变量装配：不写本地 config.json，仅靠 4 个环境变量即能 `createAppCenter()`
- [x] 扫码登录闭环：前端 SSE 收二维码 → 手机扫码 → 双写 WebDAV → 前端刷新为已登录
- [x] 跨实例验证：两个 app 实例共享 WebDAV，其一登录后另一能读到登录态
- [x] 基础查询：登录后展示网易云昵称/头像/签名 + 歌单列表
- [ ] `pnpm check` 通过（app 的 typecheck 已通过；全仓 build/test 为既有 packages，与 app 无关）
