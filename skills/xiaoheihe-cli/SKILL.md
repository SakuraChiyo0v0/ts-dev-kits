# sc-xiaoheihe CLI

让 AI 直接用 `sc-xiaoheihe` 命令行操作小黑盒(xiaoheihe.cn)SDK:**P0 只读**——扫码登录、帖子/评论/首页帖子流/@消息/用户资料查询。**不提供任何写操作**(回复评论、发帖属红线扩展 P1,未实现)。

## 环境检查

```bash
sc-xiaoheihe help    # 查看命令与选项
which sc-xiaoheihe   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/xiaoheihe`。

## 登录

登录态经 `@sakurachiyo0v0/account` AuthStore 持久化(默认 `<配置根>/amechan/xiaoheihe/auth.json`),登录后查询命令自动携带会话:

```bash
sc-xiaoheihe login             # 扫码登录:自动打开浏览器显示二维码,小黑盒 App 扫码确认
sc-xiaoheihe login --no-browser # 不自动开浏览器(仅打印二维码 URL,手动打开)
sc-xiaoheihe login --qr-image qr.png   # 把二维码图片写入 qr.png(供聊天/远程渠道展示给用户扫码),不弹浏览器
sc-xiaoheihe status            # 查看登录状态
sc-xiaoheihe logout            # 清除本地登录态
```

- 二维码 URL 由 `/account/get_qrcode_url/` 获取,轮询 `/account/qr_state/` 直到扫码成功。
- 凭证含 `x_xhh_tokenid`(静态 token);登录态失效(401)时命令抛 `AUTH_EXPIRED`,需重新 `login`。
- 环境变量覆盖:`AMECHAN_XIAOHEIHE_AUTH_PATH`(登录态路径)、`AMECHAN_XIAOHEIHE_COOKIE`(直接注入 cookie,优先于 AuthStore)、`AMECHAN_XIAOHEIHE_DEVICE_ID`。

## 命令速查

### 查询(只读)

```bash
sc-xiaoheihe feed                    # 首页帖子流(linkid/title/description)
sc-xiaoheihe link <id>               # 帖子详情 + 评论区第 1 页(标题/正文段落/评论/翻页信息)
sc-xiaoheihe comments <id> [page]    # 帖子评论区翻页(默认第 1 页)
sc-xiaoheihe messages                # @消息列表(需登录;含召唤者/帖子/文本)
sc-xiaoheihe user <id>               # 用户资料(需登录)
```

- 全部 JSON 输出。
- `link` 的正文已解析为段落数组(`text`/`image` 等);评论含 `commentid/userid/username/text`。
- 帖子 id 从 `feed` 输出的 `linkid` 或小黑盒链接(`https://www.xiaoheihe.cn/community/1/list/<id>`)获取。

## 错误与风控

- `CAPTCHA`:触发小黑盒风控验证码拦截(响应含 captcha/ticket 或 show_captcha)。**SDK 不做任何规避**,此时应停止请求、稍后再试。
- `RATE_LIMIT`:请求过于频繁,降低频率。
- `AUTH_EXPIRED` / `LOGIN_REQUIRED`:需重新 `sc-xiaoheihe login`。
- `API_ERROR`:接口返回异常(带 `serverMsg`,如"该内容已被删除")。

## 合规边界

- 只读查询 + 自己账号登录态;**不提供回复评论/发帖等写命令**(P1 红线扩展,待用户拍板)。
- 不含机器人规避逻辑(验证码破解、冷却切换、影子检测、备用号、自动刷帖)——遇到风控就停,不要重试轰炸。
