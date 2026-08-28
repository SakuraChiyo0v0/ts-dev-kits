# account-panel

网易云音乐账号面板 —— `apps/*` 的第一个标杆 demo，验证 Web 应用骨架 + 统一认证装配 + 扫码登录闭环。

## 功能

- 展示网易云登录状态（已登录 / 未登录）
- 扫码登录：前端经 SSE 收二维码 → 手机网易云 App 扫码确认 → 后端写回 WebDAV（双写本地 + 远程）
- 登录后展示昵称 / 头像 / 签名 + 歌单列表

## 技术栈

- 后端：Hono + `@hono/node-server`（SSE、静态托管、RPC）
- 前端：React 19 + Vite 8 + Tailwind CSS 4
- SDK：`@sakurachiyo0v0/config` + `@sakurachiyo0v0/account` + `@sakurachiyo0v0/netease-music`
- 类型安全：Hono RPC（`hc<AppType>`）端到端类型安全

## 环境变量

复制 `.env.example` 为 `.env` 并填写（`pnpm dev` 会自动加载 `.env`）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `WEBDAV_URL` | 是 | WebDAV 根地址 |
| `WEBDAV_USERNAME` | 否 | WebDAV 用户名 |
| `WEBDAV_PASSWORD` | 否 | WebDAV 密码 |
| `WEBDAV_CONFIG_KEY` | 是 | 加密密钥（不可丢失，丢了云端密文无法解密） |
| `PORT` | 否 | 服务端口，默认 8787 |

> 登录态统一存 WebDAV 加密域 `/amechan/secrets/auth/netease-music`；WebDAV 是唯一事实源，容器本地 `auth.json` 只是缓存，无需持久化。

## 启动

```bash
# 依赖安装（仓库根）
pnpm install

# 开发模式（server:8787 + client:5173，Vite proxy /api）
cd apps/account-panel
pnpm dev

# 生产构建 + 运行
pnpm build
NODE_ENV=production pnpm start
```

浏览器打开 http://localhost:5173（dev）或 http://localhost:8787（生产）。

## 验证「一次登录、全局配好」

两个实例共享同一 WebDAV（同一组环境变量），其一扫码登录后，另一个实例的 `/api/account` 也能读到登录态。
