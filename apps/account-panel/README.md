# account-panel

网易云音乐面板 —— `apps/*` 的第一个标杆 demo，验证 Web 应用骨架 + 统一认证装配 + 扫码登录闭环。

## 功能

- **登录**：扫码登录（SSE 推二维码）→ 写回 WebDAV（双写本地 + 远程），跨实例一次登录全局配好
- **账号**：昵称 / 头像 / 签名 / VIP 等级 / 歌单列表
- **歌单**：网格展示、搜索过滤、排序（默认/名称/歌曲数）、新建歌单、分享歌单
- **搜索**：网易云歌曲搜索（含歌手/专辑/时长）+ 搜索历史
- **播放**：真实取流播放、进度条点击/拖动跳转、上一首/下一首、循环模式、自动下一首、播放倍速、睡眠定时、音量控制、断点续播、最近播放、播放统计
- **歌词**：全屏双语歌词、当前句高亮 + 自动滚动、手动滚动暂停、双语/原文/翻译切换、字号调节、点击歌词跳转
- **收藏**：红心收藏 / 取消（歌单内 + 播放栏）
- **体验**：Apple Music 风格 UI、深色/浅色主题（跟随系统）、响应式、键盘快捷键、PWA、错误 toast、加载骨架 / 进度条

## 键盘快捷键

| 键 | 动作 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| ← / → | 快退 / 快进 5 秒 |
| ↑ / ↓ | 上一首 / 下一首 |
| M | 静音 / 取消静音 |
| ? | 显示 / 隐藏快捷键帮助 |

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

## Docker 部署

```bash
# 在仓库根构建（构建上下文必须是仓库根，见 Dockerfile 注释）
docker build -f apps/account-panel/Dockerfile -t account-panel .

# 运行（注入 WebDAV 环境变量）
docker run -d -p 8787:8787 \
  -e WEBDAV_URL=<url> \
  -e WEBDAV_USERNAME=<user> \
  -e WEBDAV_PASSWORD=<pass> \
  -e WEBDAV_CONFIG_KEY=<key> \
  account-panel
```

容器无状态：登录态在 WebDAV，本地只是缓存，无需挂卷。

## 验证「一次登录、全局配好」

两个实例共享同一 WebDAV（同一组环境变量），其一扫码登录后，另一个实例的 `/api/account` 也能读到登录态。
