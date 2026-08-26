# @sakurachiyo0v0/xiaoheihe

小黑盒(xiaoheihe.cn)SDK:扫码登录(复用 `@sakurachiyo0v0/account` 骨架)+ hkey/nonce 签名 + **只读查询**(帖子/评论/feed/@消息/用户)。P0 只读,写操作(回复评论)属红线扩展(P1,待拍板)。

协议层提炼自 Go 参考实现 [xhhRobot](https://github.com/qingkongfeixing/xhhRobot)(xhh/ 包),仅取协议、不含机器人逻辑(AI 生成/影子检测/备用号/冷却规避等一律不包含)。

## 适用环境

- Node.js 20+;登录态经 `@sakurachiyo0v0/account` 的 AuthStore 持久化(默认 `<配置根>/amechan/xiaoheihe/auth.json`)。
- 小黑盒 API 为逆向协议,签名算法可能随版本更新失效;算法集中在 `src/sign.ts`,更新时只改该文件。

## 安装方式

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/xiaoheihe@workspace:*
```

从 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 中授权构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/xiaoheihe"
```

## 快速开始

```ts
import { createXiaoheiheClient, xiaoheiheQrAdapter } from "@sakurachiyo0v0/xiaoheihe";
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";

// 1. 扫码登录(首次)
await qrcodeLogin({
  adapter: xiaoheiheQrAdapter(),
  store: new AuthStore({ platform: "xiaoheihe" }),
});

// 2. 创建客户端(自动从 AuthStore 加载 cookie)
const client = createXiaoheiheClient();

// (可选)登录态多端同步:配置远程加密命名空间,登录态双写本地+远程
import { createConfigCenter } from "@sakurachiyo0v0/config";
const remote = createConfigCenter().namespace("auth", { encrypt: true }); // /amechan/secrets/auth
const client2 = createXiaoheiheClient({ remote });
// 新机还原:先 await new AuthStore({ platform: "xiaoheihe", remote }).load() 拉取回写本地,再构造客户端
// 远程不可达时自动降级本地,不影响使用

// 3. 查询
const links = await client.feeds.list();                       // 首页帖子流
const detail = await client.links.getDetail({ linkId: links[0]!.linkid });  // 帖子详情+评论
const subs = await client.links.getSubComments({ rootCommentId: 1001 });    // 子评论翻页
const messages = await client.messages.listAt();               // @消息(需登录)
const profile = await client.user.getProfile(123);             // 用户资料(需登录)
await client.close();
```

## API 一览

| 方法 | 端点 | 说明 | 需登录 |
| --- | --- | --- | --- |
| `client.feeds.list()` | `GET /bbs/app/feeds` | 首页帖子流 | 建议 |
| `client.links.getDetail({ linkId, page?, limit? })` | `GET /bbs/app/link/tree` | 帖子详情 + 评论区单页(正文解析为段落数组) | 建议 |
| `client.links.getSubComments({ rootCommentId, lastval? })` | `GET /bbs/app/comment/sub/comments` | 子评论游标翻页 | 建议 |
| `client.messages.listAt({ offset?, limit? })` | `GET /bbs/app/user/message` | @消息列表 | 是 |
| `client.user.getProfile(userId)` | `GET /bbs/app/user/profile` | 用户资料 | 是 |
| `client.auth.status()` | (读取 @消息校验) | 登录态校验 | — |
| `client.auth.logout()` | — | 清除本地登录态 | — |
| `xiaoheiheQrAdapter()` | — | 扫码登录适配器(供 `qrcodeLogin`) | — |

写操作(`POST /bbs/app/comment/create` 回复评论)**不在 P0 提供**——属红线扩展,待用户拍板后以 P1 实现。

## 签名与公共参数(内部自动处理)

每个请求自动注入:

- `hkey` / `_time` / `nonce`:签名参数(算法见 `src/sign.ts`,对照 Go 参考实现;`hkey` 只对 Path 计算,POST body 不参与);
- 固定公共参数:`os_type=web`、`app=web`、`client_type=web`、`version=999.0.4`、`web_version=2.5`、`x_client_type=web`、`x_app=heybox_website`、`x_os_type=Windows`、`device_info=Chrome`、`device_id`(默认 `test-device-001`,可用 `deviceId` 选项覆盖);
- 请求头:`host: api.xiaoheihe.cn`、`Referer: https://www.xiaoheihe.cn/`。

## 错误码

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `NETWORK` | 网络失败 | 检查网络 |
| `API_ERROR` | 接口返回非 ok(含 HTTP 4xx/5xx) | 查看 `serverMsg` |
| `LOGIN_REQUIRED` | 需要登录 | 请先扫码登录 |
| `AUTH_EXPIRED` | 登录态失效(401) | 重新扫码登录 |
| `CAPTCHA` | 触发风控验证码拦截 | 稍后再试(不做规避) |
| `RATE_LIMIT` | 请求过于频繁(429) | 降低频率 |
| `TIMEOUT` | 请求超时 | 稍后重试 |
| `INVALID_URL` | 链接/参数非法 | 检查入参 |
| `CONFIGURATION` | 配置缺失/非法 | 检查配置 |
| `UNKNOWN` | 未知错误 | 查看日志(脱敏) |

## 合规边界

- **只读查询 + 自己账号的登录态**;不含任何机器人规避逻辑(验证码破解、冷却切换、影子检测、备用号、刷帖编排)。
- 风控**只感知不规避**:响应含 `captcha`/`ticket` 或 `status` 为 `show_captcha`/`error_captcha` 时抛 `CAPTCHA`,由上层决定处理。
- 写操作(P1)若实现,只允许操作自己账号,不做刷量/水军行为。

## CLI

`sc-xiaoheihe`(随包提供):

```powershell
sc-xiaoheihe login          # 扫码登录并持久化(--no-browser 关浏览器)
sc-xiaoheihe status         # 登录状态
sc-xiaoheihe logout         # 清除登录态
sc-xiaoheihe feed           # 首页帖子流
sc-xiaoheihe link <id>      # 帖子详情+评论
sc-xiaoheihe comments <id> [page]  # 评论区翻页
sc-xiaoheihe messages       # @消息
sc-xiaoheihe user <id>      # 用户资料
```

环境变量:`AMECHAN_XIAOHEIHE_AUTH_PATH` / `AMECHAN_XIAOHEIHE_BASE_URL`(mock 测试用)/ `AMECHAN_XIAOHEIHE_COOKIE` / `AMECHAN_XIAOHEIHE_DEVICE_ID`。CLI 手册见 [`skills/xiaoheihe-cli/SKILL.md`](../../skills/xiaoheihe-cli/SKILL.md)。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/xiaoheihe typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/xiaoheihe test        # 37 单测(mock 服务器真实协议路径)
pnpm --filter @sakurachiyo0v0/xiaoheihe build       # 构建 ESM + CJS + d.ts + CLI
```

真实 API 冒烟(需登录态,不入测试套件):用 `xhhRobot/cookie.json` 或 CLI 登录后调用 `feeds` / `links.getDetail` / `getSubComments`,已验证通过(签名算法被真实服务接受)。

## 开发

- 签名算法对照 Go 参考实现 `xhh/getkey.go` 逐字节对齐;`src/sign.ts` 的常量表与位运算改动需同步单测。
- 数据模型对照 `xhh/*.go` 的 struct;`link.text` 为 JSON 字符串需经 `parseLinkText` 二次解析,`userid` 可能为数字或字符串。

设计文档:[`docs/superpowers/specs/2026-08-24-xiaoheihe-sdk-design.md`](../../docs/superpowers/specs/2026-08-24-xiaoheihe-sdk-design.md)
