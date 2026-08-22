# amechan-ffmpeg 媒体处理 CLI

让 AI 直接用 `amechan-ffmpeg` 命令行处理音视频与图片。无需写代码,安装 CLI 后即可运行。

## 环境检查

```bash
amechan-ffmpeg help    # 查看所有命令
which amechan-ffmpeg   # 确认已安装
```

未安装时:`npm i -g @sakurachiyo0v0/ffmpeg`(或 `pnpm add -g @sakurachiyo0v0/ffmpeg`)。需系统已装 ffmpeg。

## 命令速查

所有命令输出 JSON。通用参数:`-i/--input`(输入)、`-o/--output`(输出)、`-y/--overwrite`(覆盖)。

### 媒体信息

```bash
amechan-ffmpeg probe -i input.mp4    # 读取元数据(格式/时长/流/分辨率)
```

### 视频

```bash
# 转码
amechan-ffmpeg transcode -i in.mp4 -o out.webm --video-codec libvpx --audio-codec libopus -y
amechan-ffmpeg transcode -i in.mov -o out.mp4 --video-codec libx264 --audio-codec aac -y

# 剪切片段
amechan-ffmpeg cut -i in.mp4 -o clip.mp4 --start 00:00:10 --duration 00:00:05 -y

# 拼接
amechan-ffmpeg concat a.mp4 b.mp4 -o merged.mp4 -y

# 加水印
amechan-ffmpeg watermark -i in.mp4 --watermark logo.png -o out.mp4 --position bottom-right --opacity 0.8 -y

# 转 GIF
amechan-ffmpeg to-gif -i in.mp4 -o out.gif --width 240 --fps 12 -y

# 截图 / 缩略图
amechan-ffmpeg extract-frame -i in.mp4 -o frame.jpg --time 00:00:01 -y
amechan-ffmpeg thumbnail -i in.mp4 -o thumb.jpg --width 320 -y
```

### 音频

```bash
# 提取/转换
amechan-ffmpeg extract-audio -i in.mp4 -o audio.mp3 -y
amechan-ffmpeg convert-audio -i in.flac -o out.mp3 --audio-codec libmp3lame --audio-bitrate 320k -y

# 音量 / 归一化
amechan-ffmpeg set-volume -i in.mp3 -o loud.mp3 --volume 1.5 -y
amechan-ffmpeg normalize-audio -i in.mp3 -o norm.mp3 -y

# 合并
amechan-ffmpeg join-audio a.mp3 b.mp3 -o merged.mp3 -y
```

### 图片

```bash
amechan-ffmpeg resize-image -i big.png -o small.png --width 800 -y
amechan-ffmpeg crop-image -i in.jpg -o out.jpg --width 600 --height 400 -y
amechan-ffmpeg convert-image -i in.png -o out.webp --quality 85 -y
amechan-ffmpeg compress-image -i in.jpg -o compressed.jpg --width 1200 --quality 60 -y
amechan-ffmpeg composite-image -i base.png --overlay overlay.png -o composite.png --x 10 --y 10 -y
```

## 任务配方

### 把视频转成网页兼容格式

```bash
amechan-ffmpeg transcode -i input.mp4 -o output.webm --video-codec libvpx --audio-codec libopus -y
```

### 提取视频中的音频为 MP3

```bash
amechan-ffmpeg extract-audio -i video.mp4 -o audio.mp3 -y
```

### 压缩大图

```bash
amechan-ffmpeg compress-image -i large.jpg -o small.jpg --width 1200 --quality 60 -y
```

## 陷阱清单

- **必须加 `-y`**(或 `--overwrite`),否则输出已存在会失败。
- **编码器与容器匹配**:mp4→`libx264`+`aac`,webm→`libvpx`+`libopus`。
- **concat 的位置参数**是输入文件,`-o` 指定输出。
- **probe 输出是 JSON**,脚本可直接解析。
- **失败看 stderr** 的错误消息。

## 验证

- 每个命令成功输出 `{"exitCode":0,...}`。
- 用 `amechan-ffmpeg probe -o <输出>` 复核结果。
