---
name: netease-music-cli
description: 用 sc-netease 命令行解析/下载网易云音乐、管理歌单与登录
---

# sc-netease CLI

让 AI 直接用 `sc-netease` 命令行操作网易云音乐:解析/下载歌曲、收藏夹管理(歌单/红心/订阅)。无需写代码。

## 环境检查

```bash
sc-netease --help  # 查看命令与选项
which sc-netease   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/netease-music`(需系统已装 ffmpeg 用于 ID3 标签写入)。

## 登录

登录态自动从 AuthStore 加载(默认 `<配置根>/amechan/netease-music/auth.json`),**无需手动传 cookie**:

```bash
sc-netease login              # 扫码登录(自动打开浏览器窗口)
sc-netease login --no-browser # 不弹浏览器,只打印二维码 URL 手动扫码
sc-netease login --qr-image qr.png  # 把二维码图片写入 qr.png(供聊天/远程渠道展示给用户扫码),不弹浏览器
sc-netease status             # 查看登录状态(是否已登录)
sc-netease logout             # 清除本地登录态
```

- `--auth-path <path>` 可指定登录态文件路径(或环境变量 `AMECHAN_NETEASE_AUTH_PATH`)。
- 登录态过期(MUSIC_U 失效)时重新 `login`。

## 命令速查

### 解析 / 下载

```bash
sc-netease parse "https://music.163.com/song?id=123456"
# 输出 JSON,每项含 id/title/artists

sc-netease parse "https://music.163.com/playlist?id=123456"
# 歌单链接展开为歌曲清单

sc-netease download "https://music.163.com/song?id=123456"
# 默认品质 exhigh,下载到当前目录

sc-netease download "https://music.163.com/song?id=123456" --level lossless --output-dir ./music
# 指定品质与输出目录

sc-netease download 123456 --no-lyric --no-cover
# 按歌曲 ID 下载,不下载歌词和封面
```

### 品质选择

| 品质 | 值 | 说明 |
| --- | --- | --- |
| 标准 | `standard` | 128kbps |
| 较高 | `higher` | 192kbps |
| 极高 | `exhigh` | 320kbps(默认) |
| 无损 | `lossless` | FLAC,需 VIP |
| Hi-Res | `hires` | Hi-Res FLAC,需 VIP |

> **权限预检:** 下载前 SDK 会根据歌曲 `st/fee` + 账号 VIP 信息计算可用品质清单,目标品质不在清单内 → 抛 `PRIVILEGE_DENIED`(严格模式,不降级不绕行)。

> **试听拦截:** 取流响应出现试听特征(`freeTrialInfo` 或时长明显短于完整歌曲) → 抛 `TRIAL_ONLY`,绝不落盘不完整音频。

### 歌词选项

```bash
--lyric-mode both        # 原文+翻译(默认)
--lyric-mode original    # 仅原文
--lyric-mode translated  # 仅翻译
--no-lyric               # 不下载歌词
```

### 收藏夹管理

```bash
sc-netease favorites                    # 列出用户歌单(含"我喜欢的音乐")
sc-netease favorites --uid 123456       # 查看指定用户的歌单

sc-netease likes                        # 列出红心(喜欢)歌曲 ID
sc-netease likes --uid 123456           # 查看指定用户红心列表

sc-netease like <songId>                # 红心收藏一首歌
sc-netease unlike <songId>              # 取消红心收藏
```

### 歌单管理

```bash
sc-netease playlist-create <name>             # 创建歌单(公开)
sc-netease playlist-create <name> --privacy 10  # 创建隐私歌单
sc-netease playlist-delete <playlistId>       # 删除歌单

sc-netease playlist-add <playlistId> <songId...>    # 歌单添加歌曲(支持多个 songId)
sc-netease playlist-remove <playlistId> <songId...> # 歌单移除歌曲(支持多个 songId)
```

### 订阅歌单

```bash
sc-netease subscribe <playlistId>       # 收藏(订阅)歌单
sc-netease unsubscribe <playlistId>     # 取消收藏歌单
```

## 任务配方

### 下载一首歌(最简流程)

```bash
sc-netease login   # 首次需登录
sc-netease download "https://music.163.com/song?id=123456" --output-dir ./downloads
```

### 批量下载歌单

```bash
sc-netease parse "https://music.163.com/playlist?id=18195106754"
# 输出歌曲列表 JSON,拿到歌曲 ID 后逐个下载
sc-netease download <songId1> --output-dir ./downloads --level exhigh
sc-netease download <songId2> --output-dir ./downloads --level exhigh
```

### 查看并管理收藏夹

```bash
sc-netease favorites                     # 列出歌单,找到目标歌单 id
sc-netease playlist-add <playlistId> <songId1> <songId2>  # 批量添加
sc-netease playlist-remove <playlistId> <songId1>         # 移除
sc-netease like <songId>                 # 红心收藏
sc-netease subscribe <playlistId>        # 收藏他人歌单
```

## 陷阱清单

- **未登录只能获取免费歌曲**,VIP 歌曲需登录且开通会员。
- **`--level` 超出权限会报 `PRIVILEGE_DENIED`**,不会自动降级。
- **试听歌曲拒绝下载**,SDK 检测到 `freeTrialInfo` 会抛 `TRIAL_ONLY`。
- **登录态敏感**,存本地 `auth.json`,不要在命令里明文传 cookie。
- **11 位纯数字歌单 id 会被显示层打码**(如 `181****6754`),这**只是显示行为,数据完整**——不要复制打码后的文本当参数传,请在脚本内部用完整 id。
- **网易云无 refresh_token 续期机制**,登录态过期需重新 `login`。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `AMECHAN_NETEASE_BASE_URL` | 覆盖 API baseUrl(测试用 mock 服务器) |
| `AMECHAN_NETEASE_AUTH_PATH` | 覆盖登录态存储路径 |

## 验证

- `download` 成功输出 `{"ok":true,"file":"...mp3/flac","level":"exhigh"}`。
- `login` 后 `status` 应显示 `loggedIn: true`。
- 用 `sc-ffmpeg probe -i <输出>` 检查时长/码率。
