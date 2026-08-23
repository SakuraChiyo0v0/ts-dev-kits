# amechan-booth CLI

让 AI 直接用 `amechan-booth` 命令行操作 BOOTH(booth.pm):登录、商品解析、免费领取、付费加购、文件下载。无需写代码。

## 环境检查

```bash
amechan-booth help    # 查看命令与选项
which amechan-booth   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/booth`。

## 登录

登录态自动从 `auth.json` 加载(默认 `<配置根>/amechan/booth/auth.json`),**无需手动传 cookie**:

```bash
amechan-booth login              # 自动浏览器登录:弹出独立 Chrome,登录后自动捕获会话(零复制粘贴)
amechan-booth login --reuse      # 复用日常浏览器登录态(需先关闭 Chrome;免重新输账号密码)
amechan-booth login --manual     # 手动模式:F12 复制 Cookie 头粘贴
amechan-booth status             # 查看登录状态
amechan-booth logout             # 清除本地登录态
```

- `login` 自动检测本机 Chrome/Edge,通过 CDP 打开独立窗口(临时 profile,不碰主浏览器),登录后提取全部会话 cookie 并持久化。
- `login --reuse` 用日常浏览器 profile 启动(带其登录态,免输账号);需先完全关闭该浏览器(Chrome 运行中其登录态数据被文件锁物理锁死,无法读取)。
- 无可用浏览器时回退捕获页(粘贴 Cookie 头)。
- `--auth-path <path>` 可指定登录态文件路径(或环境变量 `AMECHAN_BOOTH_AUTH_PATH`)。
- 登录走 Pixiv 账号体系(会话 cookie);BOOTH 无官方公开 API,SDK 基于页面协议模拟。
- 付费商品支付永远在浏览器手动完成,SDK 不代付。

## 命令速查

### 解析商品

```bash
amechan-booth parse "https://booth.pm/ja/items/12345"
amechan-booth parse 12345
# 输出商品 id / 标题 / 价格(日元,0=免费)/ 店铺 / 是否已拥有

amechan-booth parse "https://booth.pm/ja/items/12345" --detail
# 额外输出:简介/正文(description)+ 全部购买项(variations,含免费/付费档)
# 购买项示例:名称 / 价格 / 是否免费 / 免费项下载直链 / variation_id
amechan-booth parse "12345" --detail --no-description   # 只要购买项,不要简介(省 token)
amechan-booth parse "12345" --detail --no-variations    # 只要简介,不要购买项
```

输入支持:`booth.pm/<lang>/items/<id>` 链接(任意语言前缀)或纯数字 ID。

### 领取商品

```bash
amechan-booth claim "https://booth.pm/ja/items/12345"
# 免费商品 → claimed,自动下载到本地(默认)
# 付费商品 → paid-pending + 购物车 URL(浏览器手动加购/支付,不下载)

amechan-booth claim "https://booth.pm/ja/items/1" "https://booth.pm/ja/items/2" --concurrency 2
# 批量领取,并发可配(默认 1,避免站方压力)

amechan-booth claim "12345" --no-download
# 只领取不下载

amechan-booth claim "12345" --output-dir ./downloads
# 指定下载目录(默认当前目录)
```

结果字段:`status` = `claimed`(免费领取,含 `downloadUrl` 与 `files`)/ `paid-pending`(付费加购,含 `payUrl`)/ `skipped`(已拥有)/ `failed`(含错误码)。

### 下载文件

```bash
amechan-booth download "https://s6.booth.pm/xxxx/...zip?X-Amz-..." --output-dir ./downloads
# 按下载直链下载文件(claim 结果里的 downloadUrl)
```

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `NETWORK` | 网络失败,检查网络 |
| `API_ERROR` | BOOTH 页面/接口结构变化,需更新 SDK |
| `NOT_FOUND` | 商品不存在/已下架 |
| `INVALID_URL` | 输入不是 booth 链接或纯 ID |
| `LOGIN_REQUIRED` | 未登录,先运行 `login` |
| `AUTH_EXPIRED` | 会话失效,重新 `login` |
| `ALREADY_OWNED` | 已拥有(claim 显示为 skipped) |
| `PAYMENT_REQUIRED` | 付费待支付(claim 显示为 paid-pending) |
| `DOWNLOAD_FAILED` | 文件下载失败 |

## 合规提醒

- 只操作**自己的账号**、领取/下载自己拥有的商品;不绕过支付、不伪装会员、不代抢。
- 免费商品直接下载;付费商品只加购物车(且遇 Cloudflare 人机验证时自动降级为返回购物车 URL),支付永远在浏览器手动完成。
- 批量领取默认并发 1;不鼓励囤积转售。
- 测试/自定义网关可用环境变量 `AMECHAN_BOOTH_BASE_URL` 覆盖站点基地址。
