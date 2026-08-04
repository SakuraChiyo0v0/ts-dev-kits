# amechan-bilibili 视频下载 CLI

让 AI 直接用 `amechan-bilibili` 命令行下载 B 站视频。解析链接、查看流、下载(自动合并)。

## 环境检查

```bash
amechan-bilibili help    # 查看命令
```

未安装:`npm i -g @amechan/bilibili`(需系统已装 ffmpeg 用于合并)。

## 命令速查

### 解析链接

```bash
amechan-bilibili parse --url "https://www.bilibili.com/video/BV1xx411c7mD"
# 输出 JSON 数组,每项含 type/bvid/cid/title/时长/分P
```

支持类型:投稿视频 BV/av、番剧 ep/ss、课程 cheese、音乐 au/am、UP空间、收藏夹、合集、每周必看、稍后再看、历史记录。

### 查看播放流

```bash
amechan-bilibili streams --url "BV链接" --quality 80
# 输出清晰度、视频流列表(编码)、音频流列表
```

### 下载

```bash
# 默认 720P,合并音视频输出 mp4
amechan-bilibili download --url "BV链接" --output-dir ./videos

# 指定清晰度与编码
amechan-bilibili download --url "BV链接" --output-dir ./videos --quality 80 --codec 12

# 不合并(单独 m4s 文件)
amechan-bilibili download --url "BV链接" --output-dir ./videos --no-merge

# 多P视频选第几P
amechan-bilibili download --url "BV链接" --output-dir ./videos --index 1
```

## 登录与高画质

未登录最高 720P。登录解锁 1080P+:

```bash
amechan-bilibili download --url "BV链接" --output-dir ./videos \
  --cookie "SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx"
```

或设环境变量 `BILI_COOKIE`。需要 4K/杜比等还要大会员 cookie。

## 清晰度/编码对照

| 清晰度 | 值 |
| --- | --- |
| 720P | 64 |
| 1080P | 80 |
| 1080P 高码率 | 112 |
| 4K | 120 |

| 编码 | 值 |
| --- | --- |
| AVC/H.264 | 7 |
| HEVC/H.265 | 12 |
| AV1 | 13 |

## 任务配方

### 下载一个视频(默认流程)

```bash
amechan-bilibili download --url "https://www.bilibili.com/video/BV1GJ411x7h7" --output-dir ./downloads
```

### 下载 1080P 高码率

```bash
amechan-bilibili download --url "BV链接" --output-dir ./downloads --quality 112 --cookie "$BILI_COOKIE"
```

### 批量下载 UP 主空间视频

```bash
# 先解析出空间的所有视频链接,再逐个下载
amechan-bilibili parse --url "https://space.bilibili.com/123456"
```

## 陷阱清单

- **未登录只能下到 720P**,高画质要 cookie。
- **`--quality` 取不到时自动降级**到最高可用清晰度。
- **下载输出在 `--output-dir`**,文件名默认用视频标题。
- **`--no-merge` 会得到 .m4s 视频 + 音频两个文件**,需自行合并。
- **cookie 敏感**,用环境变量 `BILI_COOKIE` 比命令行传更安全。

## 验证

- `download` 成功输出 `{"ok":true,"output":"...mp4"}`。
- 用 `amechan-ffmpeg probe -i <输出>` 检查分辨率/时长。
