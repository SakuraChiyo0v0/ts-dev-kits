# amechan-bilibili CLI

让 AI 直接用 `amechan-bilibili` 命令行操作 B 站:下载视频 + 平台控制(收藏夹/关注/分组/登录)。无需写代码。

## 环境检查

```bash
amechan-bilibili help    # 查看命令与选项
which amechan-bilibili   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/bilibili`(需系统已装 ffmpeg 用于合并)。

## 登录

登录态自动从 `auth.json` 加载(默认 `<配置根>/amechan/bilibili/auth.json`),**无需手动传 cookie**:

```bash
amechan-bilibili login        # 扫码登录(自动打开浏览器窗口)
amechan-bilibili login --no-browser   # 不弹浏览器,只打印二维码 URL 手动扫码
amechan-bilibili status       # 查看登录状态(登录用户 mid)
amechan-bilibili logout       # 清除本地登录态
```

- `--auth-path <path>` 可指定登录态文件路径(或环境变量 `BILI_AUTH_PATH`)。
- 未登录最高 720P;登录解锁 1080P+;4K/杜比等需大会员。
- 旧的 `--cookie` 方式仍支持(调试用),但优先用 `login`。

## 命令速查

### 解析 / 下载

```bash
amechan-bilibili parse --url "https://www.bilibili.com/video/BV1xx411c7mD"
# 输出 JSON 数组,每项含 type/bvid/cid/title/时长/分P

amechan-bilibili streams --url "BV链接" --quality 80
# 输出清晰度、视频流列表(编码)、音频流列表

amechan-bilibili download --url "BV链接" --output-dir ./videos
# 默认 720P,合并音视频输出 mp4

amechan-bilibili download --url "BV链接" --output-dir ./videos --quality 80 --codec 12
# 指定清晰度与编码

amechan-bilibili download --url "BV链接" --output-dir ./videos --no-merge
# 不合并(单独 .m4s 文件)

amechan-bilibili download --url "BV链接" --output-dir ./videos --index 1
# 多P视频选第几P
```

### 收藏夹(`fav`)

```bash
amechan-bilibili fav list <mid>              # 用户创建的收藏夹列表
amechan-bilibili fav collected <mid>         # 用户收藏的收藏夹列表
amechan-bilibili fav info <mediaId>          # 收藏夹元数据
amechan-bilibili fav videos <mediaId>        # 收藏夹内容(--pn --ps)
amechan-bilibili fav create <title>          # 创建收藏夹(--intro --private)
amechan-bilibili fav edit <mediaId> <title>  # 编辑收藏夹(--intro --private)
amechan-bilibili fav delete <mediaIds...>    # 删除收藏夹(逗号或空格分隔)
amechan-bilibili fav add <rid> <mediaIds...> # 收藏视频到收藏夹(rid 为视频 id)
amechan-bilibili fav remove <rid> <mediaIds...> # 从收藏夹移除视频
```

### 关注(`relation`)

```bash
amechan-bilibili relation follow <mid>       # 关注用户
amechan-bilibili relation unfollow <mid>     # 取关
amechan-bilibili relation block <mid>        # 拉黑
amechan-bilibili relation unblock <mid>      # 取消拉黑
amechan-bilibili relation followings <vmid>  # 关注列表(--pn --ps)
amechan-bilibili relation followers <vmid>   # 粉丝列表(--pn --ps)
amechan-bilibili relation stat <vmid>        # 关系统计(关注/粉丝数)
amechan-bilibili relation blacks             # 黑名单列表
```

### 关注分组(`tag`)

```bash
amechan-bilibili tag list                    # 关注分组列表
amechan-bilibili tag users <tagid>           # 分组内用户(--pn --ps)
amechan-bilibili tag create <name>           # 创建分组
amechan-bilibili tag rename <tagid> <name>   # 重命名分组
amechan-bilibili tag delete <tagid>          # 删除分组
amechan-bilibili tag add <mid> <tagids...>   # 把用户加入分组
amechan-bilibili tag remove <mid>            # 用户移出分组(回默认)
```

## 清晰度 / 编码对照

| 清晰度 | 值 |
| --- | --- |
| 360P | 16 |
| 480P | 32 |
| 720P | 64 |
| 1080P | 80 |
| 1080P 高码率 | 112 |
| 4K | 120 |

| 编码 | codecId |
| --- | --- |
| AVC/H.264 | 7 |
| HEVC/H.265 | 12 |
| AV1 | 13 |

> 对照来源:`packages/bilibili/src/types.ts` 的 `VideoCodec` 枚举(权威定义)。

## 任务配方

### 下载一个视频(默认流程)

```bash
amechan-bilibili download --url "https://www.bilibili.com/video/BV1GJ411x7h7" --output-dir ./downloads
```

### 登录后下载 1080P

```bash
amechan-bilibili login
amechan-bilibili download --url "BV链接" --output-dir ./downloads --quality 80
```

### 把视频加入收藏夹并创建分组管理

```bash
amechan-bilibili fav create "我的收藏"
amechan-bilibili fav list <自己的mid>       # 找到新收藏夹 mediaId
amechan-bilibili fav add 170001 <mediaId>   # 收藏视频(aid 170001)
amechan-bilibili tag create "科技"
amechan-bilibili tag add 14082 <tagid>      # 把 UP 主加入分组
```

### 批量下载 UP 主空间视频

```bash
amechan-bilibili parse --url "https://space.bilibili.com/123456"   # 先解析出所有视频
# 再逐个 download
```

## 陷阱清单

- **未登录只能下到 720P**,高画质先 `login`。
- **`--quality` 取不到时自动降级**到最高可用清晰度。
- **`--no-merge` 会得到 .m4s 视频 + 音频两个文件**,需自行合并。
- **登录态敏感**,存本地 `auth.json`,不要在命令里明文传 cookie。
- **`fav add` 的 `rid` 是视频 id**(aid),传 BV 号会解析失败。
- **点赞/投币/三连写操作未提供**(刷量重灾区,合规原因);收藏/关注/分组/评论/弹幕等正常操作可用。

## 验证

- `download` 成功输出 `{"ok":true,"output":"...mp4"}`。
- `login` 后 `status` 应显示登录 mid。
- 用 `amechan-ffmpeg probe -i <输出>` 检查分辨率/时长。
