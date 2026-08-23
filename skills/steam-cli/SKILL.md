# amechan-steam CLI

让 AI 直接用 `amechan-steam` 命令行操作 Steam SDK(查询向):登录、资料、游戏库、成就、市场价、搜索、库存、商店评测、价格监控、我的挂单。**写操作仅激活码兑换一项**(`redeem`,经用户拍板扩展红线);不提供市场买卖、交易创建/接受、好友增删等任何写命令。

## 环境检查

```bash
amechan-steam help    # 查看命令与选项
which amechan-steam   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/steam`。

## 登录

登录态经 `@sakurachiyo0v0/account` AuthStore 持久化(默认 `<配置根>/amechan/steam/auth.json`),登录后 `my-listings` 等私密命令自动携带会话:

```bash
amechan-steam login --account <账号名>          # 密码登录;如开启 Guard,按提示粘贴邮箱/令牌验证码(输完 Ctrl+D/EOF 提交)
amechan-steam login --qr                        # 二维码登录:自动弹出本地二维码页面,用 Steam 手机 App 扫码确认
amechan-steam login --cookie "steamLoginSecure=...; sessionid=..."   # 导入浏览器 Cookie 头
amechan-steam status                            # 查看登录状态(登录态/账号/steamid)
amechan-steam logout                            # 清除本地登录态
```

- 密码登录自动识别 Guard 类型(邮箱验证码 / 手机令牌 TOTP / 设备确认),验证码从 stdin 读取。
- `--cookie` 适合已有浏览器会话的迁移;cookie 串为 `name=value; name2=value2` 形式。
- 私密命令(如 `my-listings`、`redeem`)未登录时抛 `LOGIN_REQUIRED`。
- `steamcommunity.com` 国内不可达:涉及市场/库存的命令需 `--proxy http://127.0.0.1:7890`(或环境变量 `AMECHAN_STEAM_PROXY`)。

## 命令速查

### 资料与游戏库

```bash
amechan-steam user "76561198006483290"          # 玩家资料摘要(支持 steamID64/3/2/vanity/URL,vanity 自动解析,需 --api-key)
amechan-steam owned-games "76561198006483290"   # 游戏库(需 --api-key;隐私空结果 → privacyRestricted:true)
amechan-steam achievements "76561198006483290" 440   # 成就(需 --api-key)
```

### 市场与价格监控(只读)

```bash
amechan-steam price 730 "AK-47 | Redline (Field-Tested)" --currency 23    # 单件即时价(CNY)
amechan-steam search "AK-47" --appid 730 --count 10                        # 市场搜索
amechan-steam watch 730 "AK-47 | Redline (Field-Tested)" --currency 23    # 价格监控:即时价+订单簿+价格历史
amechan-steam watch 730 "AK-47 | Redline (Field-Tested)" --count 5 --interval 30   # 轮询模式:每 30s 输出一次即时价快照
amechan-steam my-listings                                                  # 我的市场挂单(需登录态)
```

### 商店评测(公开)

```bash
amechan-steam reviews 730 --language schinese            # 商店评测(默认 recent;含好评率摘要)
amechan-steam reviews 730 --filter all --count 100       # 翻页拉更多(--count 每页条数)
```

### 激活码兑换(写操作,需登录态)

```bash
amechan-steam redeem "AAAAA-BBBBB-CCCCC"    # 兑换激活码到当前登录账号
```

- 失败不抛错,返回 `{ success:false, result:<ePurchaseResult码>, message }`;常见码:14=无效、15=已使用、1=已拥有、17=区域限制。
- 这是全 SDK 唯一写操作;激活码属于高敏感资产,仅在用户明确要求时执行。

### 库存

```bash
amechan-steam inventory "76561198006483290" 730 2 --language schinese   # 玩家库存(contextid 默认 2)
```

## 常用选项

| 选项 | 说明 |
| --- | --- |
| `--account <name>` | login 账号名 |
| `--qr` | login 使用二维码登录 |
| `--cookie <cookies>` | login 直接导入 Cookie 头字符串 |
| `--auth-path <path>` | 登录态存储路径(默认平台配置目录;或 `AMECHAN_STEAM_AUTH_PATH`) |
| `--api-key <key>` | Steam Web API user key(或 `AMECHAN_STEAM_API_KEY`;user/owned-games/achievements 需要) |
| `--publisher-key <key>` | publisher key(`AMECHAN_STEAM_PUBLISHER_KEY`;GetItemDefs 等) |
| `--proxy <url>` | 代理 `http(s)://` 或 `socks5://`(`AMECHAN_STEAM_PROXY`;community 国内需配置) |
| `--currency <n>` | 货币代码(price/watch,默认 1=USD;23=CNY) |
| `--appid <n>` | appid(search 过滤) |
| `--count <n>` | 条数上限 / watch 轮询次数 / reviews 每页条数 |
| `--filter <recent\|updated\|all>` | 评测过滤(reviews,默认 recent) |
| `--interval <s>` | watch 轮询间隔秒数(默认 30) |
| `--contextid <id>` | 库存 contextid(默认 2) |
| `--language <lang>` | 本地化语言(如 schinese) |
| `--json` | 输出 JSON(默认) |

环境变量 `AMECHAN_STEAM_BASE_URLS`(JSON,四主机 `{api,store,community,login}`)可覆盖 host,用于镜像/测试。

## 错误处理

- 未登录调用私密命令 → `LOGIN_REQUIRED`,提示先 `amechan-steam login`。
- 缺少 key 调用需 key 命令 → `CONFIGURATION`。
- 网络/代理问题 → `NETWORK`/`TIMEOUT`;限流 → `RATE_LIMIT`(自动退避重试后仍失败)。
- 输出一律 JSON;错误信息脱敏(不含 key/cookie/密码)。

## 合规边界

SDK 与 CLI 默认**零写操作**;**唯一例外是 `redeem` 激活码兑换**(用户拍板扩展红线)。市场买卖、交易创建/接受、好友增删、愿望单写仍一律拒绝。
