# @sakurachiyo0v0/ffmpeg

面向 Node.js 服务端的 FFmpeg/ffprobe 进程封装 SDK。底层提供任意参数的进程运行器,上层提供常用的媒体处理函数:读取元数据、转码、提取音频、截图、生成缩略图,并支持进度事件。

## 环境要求

- Node.js 20 或更高版本
- 系统已安装 `ffmpeg` 与 `ffprobe`,并可在 PATH 中找到;或在创建客户端时显式传入二进制路径

## 安装

### 同一 pnpm workspace

```powershell
pnpm add @sakurachiyo0v0/ffmpeg@workspace:*
```

### 从 GitHub monorepo 使用

先在消费项目的 `pnpm-workspace.yaml` 中授权构建脚本:

```yaml
allowBuilds:
  '@sakurachiyo0v0/ffmpeg@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
```

然后添加 monorepo 中的包目录:

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg"
```

## 快速开始

```ts
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";

const ffmpeg = createFfmpegClient();

// 读取媒体元数据
const info = await ffmpeg.probe("input.mp4");
console.log(info.formatName, info.duration, info.videoStream?.width);

// 转码并监听进度
await ffmpeg.transcode({
  input: "input.mp4",
  output: "output.webm",
  videoCodec: "libvpx",
  audioCodec: "libopus",
  progressTotalMs: info.duration * 1000,
  onProgress: (p) => console.log(`${p.percent?.toFixed(1)}%`),
});

// 提取音频
await ffmpeg.extractAudio({ input: "input.mp4", output: "audio.mp3" });

// 截图
await ffmpeg.extractFrame({ input: "input.mp4", output: "frame.jpg", time: "00:00:01" });

// 缩略图(默认 320px 宽)
await ffmpeg.thumbnail({ input: "input.mp4", output: "thumb.jpg" });
```

## 低层接口

### `run(args, options?)` / `runFfprobe(args, options?)`

以任意参数运行 ffmpeg / ffprobe,返回 `{ stdout, stderr, exitCode, durationMs }`。非零退出码不会抛错,由调用方判断:

```ts
const result = await ffmpeg.run(["-i", "input.mp4", "-c:v", "libx264", "output.mp4"]);
if (result.exitCode !== 0) {
  console.error(result.stderr);
}
```

### `runCommand(command, options?)` — 原生命令字符串

可以直接传入一整条命令行字符串,保证任何 ffmpeg 功能都能用。兼容 `ffmpeg` / `ffprobe` 前缀,支持引号和路径转义:

```ts
await ffmpeg.runCommand('ffmpeg -i "input file.mp4" -vf "drawtext=text=hello" output.mp4');
await ffmpeg.runCommand('ffprobe -v error -show_entries format=duration -of csv=p=0 in.mp4');
```

没有 `ffmpeg` 前缀时按 `ffmpeg` 处理。当高层函数无法覆盖你的需求时,`run` / `runCommand` 是兜底方案。

可选项:

| 参数 | 含义 |
| --- | --- |
| `args` | 传给二进制的完整参数(不含可执行文件本身) |
| `input` | 写入子进程 stdin 的字符串、Buffer 或流 |
| `timeoutMs` | 超时毫秒,超时抛 `TIMEOUT` 并强杀进程 |
| `onProgress` | 进度回调;需参数含 `-progress pipe:1` 且输出 `key=value` |
| `progressTotalMs` | 媒体总时长(毫秒),提供后进度对象会带 `percent` |

进度对象字段:`frame`、`fps`、`bitrate`、`totalSize`、`outTimeUs`、`outTimeMs`、`outTime`、`dupFrames`、`dropFrames`、`speed`、`percent`、`raw`。

## 高层函数

通用控制参数(所有高层函数都支持):

```ts
{
  overwrite?: boolean;          // 传 -y
  timeoutMs?: number;           // 超时毫秒
  onProgress?: (p) => void;     // 进度回调
  progressTotalMs?: number;     // 提供后进度对象带 percent
}
```

### 媒体信息

`probe(input)` — 用 ffprobe 读取元数据,返回 `ProbeResult`:`formatName` / `formatLongName` / `duration` / `size` / `bitRate`、`streams[]`(codecType / codecName / width / height / duration / bitRate / sampleRate / channels / language)、`videoStream` / `audioStream` 便捷指针。

### 视频

| 函数 | 说明 |
| --- | --- |
| `transcode({ input, output, videoCodec?, audioCodec?, videoBitrate?, audioBitrate?, scale? })` | 转码/重封装,可选编码器、码率、缩放 |
| `cut({ input, output, start?, end?, duration?, copy?, videoCodec?, audioCodec? })` | 剪切片段。`start`/`end`/`duration` 指定时间范围;`copy: true` 走流复制(快但不精确) |
| `concat({ inputs[], output, copy?, videoCodec?, audioCodec? })` | 拼接多个片段。`copy: true` 用 concat demuxer,要求片段编码一致 |
| `watermark({ input, watermark, output, position?, opacity? })` | 叠加图片水印。`position`: top-left / top-right / bottom-left / bottom-right / center;`opacity`: 0–1 |
| `loopVideo({ input, output, loopCount?, outputDuration? })` | 循环视频。`loopCount: -1` 无限循环,可用 `outputDuration` 截断 |
| `toGif({ input, output, fps?, width?, start?, duration? })` | 转 GIF 动图。默认 fps 10、宽 320,自动调色板 |
| `extractFrame({ input, output, time?, scale? })` | 截取单帧为图片 |
| `thumbnail({ input, output, width?, time? })` | 缩略图,默认宽 320、时间点 1 秒 |

```ts
await ffmpeg.cut({ input: "in.mp4", output: "clip.mp4", start: "00:00:10", duration: "00:00:05" });
await ffmpeg.concat({ inputs: ["a.mp4", "b.mp4"], output: "merged.mp4" });
await ffmpeg.watermark({ input: "in.mp4", watermark: "logo.png", output: "out.mp4", position: "bottom-right", opacity: 0.8 });
await ffmpeg.toGif({ input: "in.mp4", output: "out.gif", width: 240 });
```

### 音频

| 函数 | 说明 |
| --- | --- |
| `extractAudio({ input, output, audioCodec?, audioBitrate? })` | 从媒体提取音频轨(默认 MP3 192k) |
| `convertAudio({ input, output, audioCodec?, audioBitrate?, channels?, sampleRate? })` | 通用音频格式转换 |
| `toMp3({...})` / `toFlac({...})` / `toWav({...})` / `toOgg({...})` / `toM4a({...})` | 便捷转换,自动选择常用编码器与码率 |
| `setVolume({ input, output, volume })` | 音量调整。`volume`: 倍率(`1.5`)或 dB(`"3dB"`) |
| `normalizeAudio({ input, output, loudnessTarget?, truePeak? })` | 响度归一化(loudnorm),默认目标 -16 LUFS |
| `joinAudio({ inputs[], output, audioCodec?, audioBitrate? })` | 按顺序拼接多个音频 |

```ts
await ffmpeg.toMp3({ input: "in.flac", output: "out.mp3" });
await ffmpeg.setVolume({ input: "in.mp3", output: "loud.mp3", volume: 1.5 });
await ffmpeg.joinAudio({ inputs: ["a.mp3", "b.mp3"], output: "merged.mp3" });
```

### 图片

| 函数 | 说明 |
| --- | --- |
| `resizeImage({ input, output, width?, height? })` | 缩放。只给一维时另一维按比例 |
| `cropImage({ input, output, width, height, x?, y? })` | 裁剪。`x`/`y` 默认居中 |
| `convertImage({ input, output, quality? })` | 格式转换,支持 JPEG/WebP 质量 |
| `compositeImage({ input, overlay, output, x?, y? })` | 把一张图叠加到另一张上 |
| `compressImage({ input, output, width?, quality? })` | 压缩(缩放 + 降质量),默认质量 70 |

```ts
await ffmpeg.resizeImage({ input: "big.png", output: "small.png", width: 800 });
await ffmpeg.cropImage({ input: "in.jpg", output: "out.jpg", width: 600, height: 400 });
await ffmpeg.convertImage({ input: "in.png", output: "out.webp", quality: 85 });
await ffmpeg.compressImage({ input: "in.jpg", output: "compressed.jpg", width: 1200, quality: 60 });
```

## 错误处理

统一 `FfmpegError`,错误码:

| 错误码 | 含义 |
| --- | --- |
| `CONFIGURATION` | 必填参数缺失 |
| `NOT_FOUND` | 显式指定的二进制路径不存在,或运行时找不到二进制 |
| `INVALID_INPUT` | 输入校验失败(预留) |
| `TIMEOUT` | 命令超过 `timeoutMs` 未完成 |
| `CANCELLED` | 进程被取消(预留) |
| `PROCESS_ERROR` | 进程启动失败、非零退出或输入写入失败 |
| `UNKNOWN` | 未能分类的异常 |

`run`/`runFfprobe` 对非零退出码**不抛错**(由调用方判断),高层函数(如 `probe`)在失败时会抛 `PROCESS_ERROR` 并附带 `exitCode` 与 `stderr`。

## 注意事项

- SDK 不自动补 `-y`。目标文件已存在且未传 `overwrite: true` 时,ffmpeg 会交互询问,进程可能挂起;请显式传 `overwrite` 或确保输出路径干净。
- `run` 不带 `-progress pipe:1` 时不会有进度回调;高层函数默认带 `-progress pipe:1` 和 `-nostats`。
- 超时用 `SIGKILL` 强制结束进程,任务不可恢复。如需优雅结束,请自行管理子进程。

## 验证命令

```powershell
pnpm --filter @sakurachiyo0v0/ffmpeg typecheck
pnpm --filter @sakurachiyo0v0/ffmpeg test
pnpm --filter @sakurachiyo0v0/ffmpeg build
```
