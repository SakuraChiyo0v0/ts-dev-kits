# FFmpeg 音视频/图片处理命令手册

让 AI 直接使用系统 `ffmpeg` / `ffprobe` 命令完成音视频与图片处理。本 skill 不需要安装任何 npm 包,所有配方都是可直接执行的命令。

## 环境检查

```bash
ffmpeg -version    # 确认已安装
ffprobe -version
```

未安装时提示用户先安装(如 Ubuntu: `sudo apt install ffmpeg`;macOS: `brew install ffmpeg`;Windows: 下载静态构建加入 PATH)。

## 基本使用

```bash
ffmpeg -i input.mp4 output.mp4          # 基础转码(自动选编码器)
ffprobe -v error -show_format -show_streams input.mp4   # 读取信息
```

**铁律:输出文件已存在时必须加 `-y` 覆盖**,否则 ffmpeg 会交互询问导致命令挂起。所有配方默认带 `-y`。

**常用全局参数:**

| 参数 | 作用 |
| --- | --- |
| `-y` | 覆盖输出文件(必须) |
| `-c:v` | 视频编码器 |
| `-c:a` | 音频编码器 |
| `-c copy` | 流复制(不重编码,快) |
| `-ss` | 起始时间(`00:00:10` 或 `10`) |
| `-t` | 时长(`00:00:05` 或 `5`) |
| `-to` | 结束时间 |
| `-vf` | 视频滤镜 |
| `-af` | 音频滤镜 |
| `-b:v` / `-b:a` | 视频/音频码率(`1M`、`192k`) |
| `-f` | 强制输出格式 |
| `-filter_complex` | 复杂滤镜图 |

## 编码器搭配速查

| 容器 | 视频编码 | 音频编码 | 适用 |
| --- | --- | --- | --- |
| `.mp4` | `libx264` | `aac` | 通用、兼容性最好 |
| `.webm` | `libvpx`(或 `libvpx-vp9`) | `libopus` | 网页 |
| `.mkv` | `libx264` | `flac`/`aac` | 高保真 |
| `.gif` | 专用调色板流程 | 无 | 动图 |

## 任务配方

### 读取媒体信息

```bash
# 基本信息
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=noprint_wrappers=1 input.mp4

# 流信息(编码器/分辨率/采样率)
ffprobe -v error -print_format json -show_format -show_streams input.mp4

# 只要时长(便于脚本)
ffprobe -v error -show_entries format=duration -of csv=p=0 input.mp4
```

### 转码 / 格式转换

```bash
# 任何格式 → H.264 MP4(通用)
ffmpeg -i input.mov -c:v libx264 -c:a aac -pix_fmt yuv420p -y output.mp4

# → WebM(网页)
ffmpeg -i input.mp4 -c:v libvpx -c:a libopus -y output.webm

# → MKV 无损音轨
ffmpeg -i input.mp4 -c:v libx264 -c:a flac -y output.mkv

# 快速重封装(不重编码,只换容器,秒完成)
ffmpeg -i input.mkv -c copy -y output.mp4
```

### 剪切片段

```bash
# 从 00:00:10 开始剪 5 秒,重编码(精确)
ffmpeg -ss 00:00:10 -i input.mp4 -t 00:00:05 -c:v libx264 -c:a aac -y clip.mp4

# 快剪(不重编码,快但可能不够精确)
ffmpeg -ss 00:00:10 -to 00:00:20 -i input.mp4 -c copy -y clip.mp4

# 从 30 秒剪到结尾
ffmpeg -ss 30 -i input.mp4 -c copy -y tail.mp4
```

### 拼接视频

```bash
# 方式一:重编码拼接(最稳,各片段参数可不同)
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" -y merged.mp4

# 方式二:快拼(要求各片段编码/分辨率一致,否则花屏)
printf "file 'a.mp4'\nfile 'b.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy -y merged.mp4
```

### 加水印

```bash
# 右下角不透明水印
ffmpeg -i input.mp4 -i logo.png -filter_complex "[1]format=rgba,colorchannelmixer=aa=0.8[wm];[0][wm]overlay=W-w-10:H-h-10" -y output.mp4

# 位置:左上 10:10 / 右上 W-w-10:10 / 左下 10:H-h-10 / 右下 W-w-10:H-h-10 / 居中 (W-w)/2:(H-h)/2
# 不透明度 aa=0.8(0-1),w/h 是水印宽高,W/H 是视频宽高
```

### 转 GIF

```bash
# 标准流程:抽帧 → 生成调色板 → 应用(避免画质劣化)
ffmpeg -i input.mp4 -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -y output.gif

# 从片段转 GIF
ffmpeg -ss 00:00:01 -t 00:00:03 -i input.mp4 -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -y output.gif
# fps=帧率 scale=宽度(高度按比例)
```

### 截图 / 缩略图

```bash
# 指定时间点截图
ffmpeg -ss 00:00:05 -i input.mp4 -frames:v 1 -y frame.jpg

# 缩略图(320 宽)
ffmpeg -ss 00:00:01 -i input.mp4 -vf "scale=320:-1" -frames:v 1 -y thumb.jpg
```

### 音频处理

```bash
# 抽音轨 → MP3
ffmpeg -i input.mp4 -vn -c:a libmp3lame -b:a 192k -y audio.mp3

# 格式转换
ffmpeg -i input.flac -c:a libmp3lame -b:a 320k -y audio.mp3    # 无损→高音质 MP3
ffmpeg -i input.mp3 -c:a flac -y audio.flac                    # → FLAC 无损
ffmpeg -i input.mp3 -c:a pcm_s16le -y audio.wav                # → WAV
ffmpeg -i input.mp3 -c:a libvorbis -b:a 192k -y audio.ogg      # → OGG
ffmpeg -i input.mp3 -c:a aac -b:a 192k -y audio.m4a            # → M4A/AAC

# 音量调整
ffmpeg -i input.mp3 -af "volume=1.5" -y louder.mp3             # 倍率
ffmpeg -i input.mp3 -af "volume=3dB" -y louder.mp3             # 或 dB

# 响度归一化(流媒体标准,目标 -16 LUFS)
ffmpeg -i input.mp3 -af "loudnorm=I=-16:TP=-1.5:LRA=11" -y normalized.mp3

# 合并音频(按顺序)
ffmpeg -i a.mp3 -i b.mp3 -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[outa]" -map "[outa]" -c:a libmp3lame -y merged.mp3
```

### 图片处理

```bash
# 缩放(只给宽,高度按比例)
ffmpeg -i big.png -vf "scale=800:-2" -y small.png

# 指定宽高(拉伸)
ffmpeg -i big.png -vf "scale=800:600" -y fixed.png

# 裁剪 600x400 居中
ffmpeg -i input.jpg -vf "crop=600:400" -y cropped.jpg
# 指定偏移 crop=宽:高:x:y,如 crop=600:400:50:100

# 格式转换(PNG→JPG,质量 -q:v 2-31,越小越好,常用 2-5)
ffmpeg -i input.png -q:v 3 -y output.jpg

# → WebP(质量 -quality 0-100)
ffmpeg -i input.png -quality 85 -y output.webp

# 两张图叠加
ffmpeg -i base.png -i overlay.png -filter_complex "overlay=10:10" -y composite.png

# 压缩(缩放 + 降质)
ffmpeg -i input.jpg -vf "scale=1200:-2" -q:v 5 -y compressed.jpg
```

### 视频高级

```bash
# 循环(源 2 秒 → 循环 3 次 → 6 秒)
ffmpeg -stream_loop 3 -i input.mp4 -c copy -y looped.mp4

# 去音轨(保留视频)
ffmpeg -i input.mp4 -an -c:v copy -y silent.mp4

# 静音(保留音轨但消音)
ffmpeg -i input.mp4 -af "volume=0" -c:v copy -y muted.mp4
```

## 时间格式

- `00:00:10` = 10 秒,`00:01:30` = 1 分 30 秒
- 也可用纯数字秒:`-ss 10`、`-t 5.5`
- 微秒:`-ss 00:00:00.500` = 半秒

## 陷阱清单

- **忘加 `-y` 且输出已存在 → 命令挂起**。所有配方默认带 `-y`。
- **编码器与容器不匹配会失败**:`.mp4` 用 `libx264`+`aac`,`.webm` 用 `libvpx`+`libopus`,别混搭。
- **MP4 用 libx264 要加 `-pix_fmt yuv420p`**,否则部分播放器无法播放。
- **`-c copy` 快拼要求各片段参数一致**,否则花屏/音画不同步。
- **`-ss` 放在 `-i` 前 = 快速seek(不精确但快),放 `-i` 后 = 精确seek(慢)**,精确剪辑用后者。
- **GIF 必须走调色板流程**(palettegen+paletteuse),直接 `-vf scale` 转 GIF 会严重劣化。
- **转码失败看 stderr**:ffmpeg 的报错在标准错误,常见 `Unknown encoder`(编码器没编译进)、`No such file`(路径错)。
- **非零退出码 = 失败**,脚本里检查 `$?`。

## 验证

- 输出文件存在且大小合理:`ls -lh output.mp4`
- 用 ffprobe 复核:`ffprobe -v error -show_entries stream=codec_name,width,height,duration -of json output.mp4`
- 截图/图片用 `ls -lh` 或图片查看器确认。
