# @sakurachiyo0v0/xiaoheihe 小黑盒 SDK 设计

状态:起草中(批准后改为「用户已批准」)
日期:2026-08-24

## 1. 当前问题与目标

- 现状:小黑盒(xiaoheihe.cn)协议目前只存在于 Go 项目 [xhhRobot](https://github.com/qingfengfeixing/xhhRobot)(用户 fork 自 `qingkongfeixing/xhhRobot`,本机 `/home/mafuyu/桌面/Projects/Github/aigc/xhhRobot`)。它是**自动回复机器人**:AI 生成评论 + 自动回帖 + 影子检测 + 备用号 + 摸鱼防风控,协议逻辑与机器人逻辑深度耦合,不可复用;仓库内也没有小黑盒 SDK。
- 目标:提炼 xhhRobot 中的**协议层**为 TypeScript SDK(登录 + 签名 + 只读查询),供仓库内其他包 / DSH 工具 / 个人脚本复用。P0 只读,写操作(回复评论)列为红线扩展,待用户拍板。
- 用户已确认:P0 只读;包名 `@sakurachiyo0v0/xiaoheihe`;配套 CLI + skill(全套形态)。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 小黑盒能力锁死在 Go 机器人里,无法从 TS 复用 | 一行 `createXiaoheiheClient()` 获得登录 + 查询能力 |
| 需要手工构造 hkey/nonce/_time 签名与公共参数 | SDK 内部自动签名,调用方无感 |
| 无登录态管理 | 复用 `@sakurachiyo0v0/account` 的 `QrLoginAdapter` + `AuthStore`,扫码登录/持久化/续期一致 |
| 机器人内置的验证码规避 / 冷却 / 影子检测等不合规逻辑 | SDK 不含任何规避逻辑;只做**风控感知**(识别 captcha 响应并抛 `CAPTCHA` 错误码,由上层决定如何处理) |
| 错误结构不一致 | 统一 `XiaoheiheError` + 错误码,消息脱敏 |

## 3. 方案选择

### 方案 A:直接移植 Go 代码为 TS(不采用)

- 优点:工作量小(照抄)。
- 缺点:xhhRobot 的 `xhh/` 目录中 `main.go`/`feed_reply.go`/`reply.go`/`shadow_check.go`/`captcha.go`/`blacklist.go`/`fallback.go` 全是机器人编排与规避逻辑(AI 调用、影子检测、备用号接替、验证码冷却、模拟打字延迟、摸鱼窗口),直接移植等于把不合规行为带进 SDK;且耦合 db/ai/config 三个外部模块。

### 方案 B:提炼协议层为独立 SDK(采用)

- 只取协议:签名(getkey.go 的 hkey/nonce/_time 混淆算法)、请求发送(sendreq.go 的公共参数与请求头)、登录(login.go 的扫码流程 + x_xhh_tokenid)、只读端点(link/tree、comment/sub/comments、feeds、user/message、user/profile)。
- 风控只感知不规避:响应含 `captcha`/`ticket` 或 `status` 为 `show_captcha` 时抛 `CAPTCHA`,不做验证码破解、不自动冷却切换账号。
- 登录态复用 `@sakurachiyo0v0/account`(`xiaoheiheQrAdapter()` 实现 `QrLoginAdapter`,凭证持久化到 `<配置根>/amechan/xiaoheihe/auth.json`)。
- 优点:干净、合规、可复用;与仓库既有 SDK(email/bilibili/steam)架构一致。
- 缺点:需重写签名算法(有参考实现,无版权问题——Go 代码是用户 fork 的公开项目,签名算法为通用混淆逻辑;实现时以协议行为为准,不逐行复制)。

### 方案 C:只做登录 + 签名,不做查询(不采用)

- 缺点:无查询能力的 SDK 价值过低;查询端点全部只读、合规,没有理由砍掉。

## 4. 仓库结构

```text
packages/xiaoheihe/
├─ src/
│  ├─ index.ts           公共出口:createXiaoheiheClient / xiaoheiheQrAdapter / XiaoheiheError
│  ├─ client.ts          客户端工厂与域对象(links / feeds / messages / user / auth)
│  ├─ api/
│  │  ├─ qrcode.ts       登录端点(get_qrcode_url / qr_state)
│  │  ├─ links.ts        帖子详情与评论(link/tree、comment/sub/comments)
│  │  ├─ feeds.ts        首页 feed
│  │  ├─ messages.ts     @消息(user/message)
│  │  └─ user.ts         用户资料(user/profile)
│  ├─ sign.ts            签名算法(hkey / nonce / _time,含常量表)
│  ├─ transport.ts       HTTP 层(公共参数注入 / cookie 携带 / 脱敏日志 / 风控识别)
│  ├─ types.ts           数据模型与枚举(field 语义的权威定义)
│  ├─ errors.ts          统一错误类 + 错误码
│  └─ cli/                sc-xiaoheihe 命令(login/status/logout/feed/link/comments/messages/user)
├─ tests/
│  ├─ sign.test.ts       签名算法单测(对照 Go 实现)
│  ├─ qrcode.test.ts     扫码登录流程(mock 本地服务器)
│  ├─ links.test.ts      帖子/评论解析 + 翻页
│  └─ helpers/mock-server.ts  本地 mock api.xiaoheihe.cn
├─ package.json          版本 / exports / scripts
└─ README.md             安装方式 / API / 参数表 / 错误码
```

## 5. 接口设计

### 协议要点(从 Go 代码提取)

- BaseUrl:`https://api.xiaoheihe.cn`;请求头:`host: api.xiaoheihe.cn`、`Referer: https://www.xiaoheihe.cn/`、POST 时 `content-type: application/x-www-form-urlencoded;charset=utf-8`。
- 公共参数(每请求注入):`os_type=web`、`app=web`、`client_type=web`、`version`(默认 `999.0.4`)、`web_version`(默认 `2.5`)、`x_client_type=web`、`x_app=heybox_website`、`heybox_id`(登录后)、`x_os_type=Windows`、`device_info=Chrome`、`device_id`(默认 `test-device-001`,可配)、`hkey`、`_time`、`nonce`、`_notip=true`。
- 签名(对照 `xhh/getkey.go`,与 Go 参考实现逐字节对齐):
  - `_time` = 当前 unix 秒;`nonce` = `MD5(time秒 + crypto/rand 随机数)` 大写 hex,随机数范围 `[0, 当前毫秒时间戳)`(JS 用 `crypto.randomInt`);
  - `hkey` = 7 字符:`s(5 字符)+ a(2 位数字)`;算法:字符映射表 `AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89`(35 字符 = 0-9 + A-Z 去 O),对 `str(_time)`(子表 33)/`reqpath`(全表 35)/`nonce`(全表 35)做查表替换 → 三串按长度升序稳定排序 → 列优先交错 → 取**前 20 字节** MD5 → 末尾 6 字符 ASCII 码过 mixed 位运算求和 `%100` 补零 → 前 5 字符再查表(子表 31);
  - `hkey` 只对 Path 计算,**不含 query**;POST 的 form body 不参与签名。
- 登录 token `x_xhh_tokenid`(静态,不随请求刷新):`";x_xhh_tokenid=" + base64(md5(登录时刻秒) + md5("唉？！云朵！") + md5("哒哒哒哒哒，好想玩原神") + md5("云！原！神！") + 0x00)`,共 65 字节。
- RSA 函数为**死代码**(Go 中无任何调用点),SDK 不实现。
- 翻页上限:楼层搜索 30 页、子评论游标 20 页(参考实现硬编码)。

### 端点表

| 端点 | 方法 | 参数 | 用途 | 登录 | 性质 |
| --- | --- | --- | --- | --- | --- |
| `/account/get_qrcode_url/` | GET | — | 获取扫码二维码 URL | 否 | 只读 |
| `/account/qr_state/` | GET | 二维码 URL 携带的 query | 轮询扫码状态,成功返回 Set-Cookie | 否 | 只读 |
| `/bbs/app/link/tree` | GET | link_id / page / is_first / index / limit / owner_only | 帖子详情 + 评论区首页 | 可匿名 | 只读 |
| `/bbs/app/comment/sub/comments` | GET | root_comment_id / lastval(游标) | 子评论游标翻页 | 是 | 只读 |
| `/bbs/app/feeds` | GET | pull=1 | 首页帖子流 | 否(建议登录) | 只读 |
| `/bbs/app/user/message` | GET | message_type=16 / offset / limit / no_more | @消息列表 | 是 | 只读 |
| `/bbs/app/user/profile` | GET | userid | 用户资料 | 是 | 只读 |
| `/bbs/app/comment/create` | POST | is_cy / link_id / reply_id / root_id / text | 回复评论 | 是 | **写(P1 红线扩展)** |

### 登录凭证结构

扫码成功后的持久化结构(与 `account` AuthStore 对齐):
`{ cookie: string; heyboxId: string; time: number }`;cookie 由 Set-Cookie 的凭证值 + `x_xhh_tokenid` 拼接而成,`heyboxId` 取 `user_heybox_id` cookie。

**健壮性(改进参考实现)**:Go 代码用 `cookie[0]/cookie[1]` 直接下标取前两个 cookie(脆弱,依赖顺序);SDK 应遍历全部 Set-Cookie,按名提取凭证 cookie 与 `user_heybox_id`;`qr_state` 的 query 用 URL 解析从 `qr_url` 提取,不用字符串截断。

### API 形状

```ts
import { createXiaoheiheClient, xiaoheiheQrAdapter } from "@sakurachiyo0v0/xiaoheihe";

// 创建客户端(未传 cookie 时自动从 AuthStore 加载)
const client = createXiaoheiheClient({ authPath?: string, baseUrl?: string, deviceId?: string, fetchImpl?: typeof fetch });

// 登录(复用 account 的 qrcodeLogin 骨架)
import { qrcodeLogin } from "@sakurachiyo0v0/account";
await qrcodeLogin({ adapter: xiaoheiheQrAdapter(), store: new AuthStore({ platform: "xiaoheihe" }) });

// 查询域
client.links.getDetail(linkId, { page?: number });        // 帖子详情 + 评论
client.links.getComments(linkId, { page?, limit? });      // 评论区(link/tree)
client.links.getSubComments(commentId, { lastval? });     // 子评论翻页
client.feeds.list();                                      // 首页帖子流
client.messages.listAt({ offset?, limit? });              // @消息(需登录)
client.user.getProfile(userId);                           // 用户资料(需登录)
client.auth.me();                                         // 当前登录用户信息

// 登出 / 状态
client.auth.status();    // 登录态校验(可只读调用一个需登录端点判断)
client.auth.logout();    // 清除本地登录态
```

## 6. 错误处理

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `NETWORK` | 网络失败 | 检查网络 |
| `API_ERROR` | 接口返回非 ok | 查看 msg |
| `LOGIN_REQUIRED` | 需要登录 | 请先扫码登录 |
| `AUTH_EXPIRED` | 登录态失效 | 重新扫码登录 |
| `CAPTCHA` | 触发风控验证码拦截 | 稍后再试(不做规避) |
| `RATE_LIMIT` | 请求过于频繁 | 降低频率 |
| `INVALID_URL` | 链接/参数非法 | 检查入参 |
| `UNKNOWN` | 未知错误 | 查看日志(脱敏) |

## 7. 测试策略

- 签名算法单测:对照 Go 参考实现的输入/输出,固定 case 断言 hkey/nonce 生成一致(含等长排序稳定性、`count%100` 补零、7 字符 hkey)。
- 本地 mock 服务器(`tests/helpers/mock-server.ts`)模拟 `api.xiaoheihe.cn` 全部端点,走真实 HTTP 协议路径:
  - 扫码登录全流程(get_qrcode_url → qr_state 轮询 → Set-Cookie 提取 → token 构造);
  - 帖子/评论/feed/消息/用户解析(含翻页、lastval 游标、`link.text` 二次 JSON.parse、userid 数字/字符串归一化);
  - 公共参数与 hkey 注入断言。
- 错误分支:响应含 `captcha`/`ticket` 或 `status` 为 `show_captcha`/`error_captcha` → `CAPTCHA`;登录态缺失 → `LOGIN_REQUIRED`;401 → `AUTH_EXPIRED`;429 → `RATE_LIMIT`。
- 写操作(P1)不做,不测。

## 8. CLI 与 skill 同步

- CLI `sc-xiaoheihe` 命令:
  - `login`(扫码,复用 account 骨架)/ `status` / `logout`
  - `feed`(首页帖子流)/ `link <id>`(帖子详情+评论)/ `comments <id>`(评论翻页)/ `messages`(@消息)/ `user <id>`(用户资料)
  - JSON 输出,与 `sc-steam` 等一致。
- 新增 `skills/xiaoheihe-cli/SKILL.md`(命令速查 + 前置条件 + 登录态说明)。
- 提交守卫(`check-skill-staleness.mjs`)会拦命令集不一致,需同步。

## 9. 版本与发布

- 首发 `0.1.0`(P0 只读);写操作(回复评论)作为 P1 红线扩展,用户拍板后 bump minor。
- 依赖:`@sakurachiyo0v0/account`(`workspace:*`)。
- 走 CI 发布;发布后 `pnpm verify:published @sakurachiyo0v0/xiaoheihe` 消费验证。

## 10. 验收条件

- [ ] 签名算法单测对照 Go 实现一致(固定 case)
- [ ] mock 服务器走通登录 + 全部只读端点解析
- [ ] 错误分支覆盖(captcha / 登录失效 / 网络 / 参数非法)
- [ ] README + packages-index 更新
- [ ] CLI 命令集与 skill 同步,守卫通过
- [ ] `pnpm check` 全绿
- [ ] 用户确认后提交推送,CI 发布成功,消费验证通过
- [ ] (P1,待拍板)写操作(回复评论)单独设计合规边界后实现

---

## 附:与 xhhRobot 的边界(合规声明)

- SDK 只取协议层;不包含:Ai 生成、自动刷帖编排、影子评论检测、备用账号接替、验证码自动处理、冷却规避、模拟打字延迟、摸鱼/时间窗口等机器人行为。
- 写操作(P1)若实现,只允许操作**自己账号**的评论,不做刷量/水军行为(参照 bilibili 红线)。
- 签名算法为协议逆向,可能随小黑盒版本更新失效;算法常量集中在 `src/sign.ts`,更新时只改该文件。
