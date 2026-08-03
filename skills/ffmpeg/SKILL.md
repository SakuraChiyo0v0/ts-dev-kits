# FFmpeg 媒体处理

让 AI 直接调用 `@amechan/ffmpeg` 包的功能处理音视频与图片:读取信息、转码、剪切、拼接、水印、GIF、音频转换、图片处理。AI 优先使用本包的高层函数,而不是自己拼 ffmpeg CLI 参数。

## 环境检查

- Node.js >= 20。
- 系统需已安装 `ffmpeg` 与 `ffprobe`(PATH 中),或调用时显式传入二进制路径。

## 是否已安装本包?

在项目 `package.json` 中查找 `@amechan/ffmpeg`:

- **已安装**:直接 `import { createFfmpegClient } from "@amechan/ffmpeg"`,跳过安装。
- **未安装但项目在 ts-dev-kits monorepo 内**:`pnpm add @amechan/ffmpeg@workspace:*`。
- **未安装且在外部项目**:
  1. 在消费项目 `pnpm-workspace.yaml` 添加授权:
     ```yaml
     allowBuilds:
       '@amechan/ffmpeg@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
     ```
  2. `pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg"`
- **无法安装包时**:降级直接用系统 `ffmpeg` CLI(见「无包降级」)。

## API 速查

```ts
import { createFfmpegClient } from "@amechan/ffmpeg";
const ffmpeg = createFfmpegClient();   // 可传 { ffmpegPath?, ffprobePath? }
```

所有高层函数接受统一控制参数: `overwrite?`(传 `-y`,必须显式给出否则输出已存在会挂起)、`timeoutMs?`、`onProgress?(p)`、`progressTotalMs?`(提供后进度对象带 `percent`)。

### 媒体信息

| 函数 | 返回 |
| --- | --- |
| `await ffmpeg.probe(input)` | `{ formatName, duration, size, streams[], videoStream?, audioStream? }` |

### 视频

| 函数 | 关键参数 |
| --- | --- |
| `ffmpeg.transcode({ input, output, videoCodec?, audioCodec?, videoBitrate?, audioBitrate?, scale? })` | 转码/重封装 |
| `ffmpeg.cut({ input, output, start?, end?, duration?, copy?, videoCodec?, audioCodec? })` | 剪切。`copy: true` 快剪但不精确 |
| `ffmpeg.concat({ inputs[], output, copy?, videoCodec?, audioCodec? })` | 拼接 |
| `ffmpeg.watermark({ input, watermark, output, position?, opacity? })` | 水印。position: top-left/top-right/bottom-left/bottom-right/center |
| `ffmpeg.loopVideo({ input, output, loopCount?, outputDuration? })` | 循环。loopCount: -1 无限 |
| `ffmpeg.toGif({ input, output, fps?, width?, start?, duration? })` | GIF。默认 fps 10、宽 320 |
| `ffmpeg.extractFrame({ input, output, time?, scale? })` | 截图 |
| `ffmpeg.thumbnail({ input, output, width?, time? })` | 缩略图,默认宽 320 |

### 音频

| 函数 | 说明 |
| --- | --- |
| `ffmpeg.extractAudio({ input, output, audioCodec?, audioBitrate? })` | 抽音轨(默认 MP3 192k) |
| `ffmpeg.toMp3({...})` / `toFlac` / `toWav` / `toOgg` / `toM4a` | 便捷转换,自动选编码器 |
| `ffmpeg.convertAudio({ input, output, audioCodec?, audioBitrate?, channels?, sampleRate? })` | 通用转换 |
| `ffmpeg.setVolume({ input, output, volume })` | 音量,倍率(`1.5`)或 dB(`"3dB"`) |
| `ffmpeg.normalizeAudio({ input, output, loudnessTarget?, truePeak? })` | 响度归一,默认 -16 LUFS |
| `ffmpeg.joinAudio({ inputs[], output, audioCodec?, audioBitrate? })` | 合并音频 |

### 图片

| 函数 | 说明 |
| --- | --- |
| `ffmpeg.resizeImage({ input, output, width?, height? })` | 缩放,只给一维自动按比例 |
| `ffmpeg.cropImage({ input, output, width, height, x?, y? })` | 裁剪,x/y 默认居中 |
| `ffmpeg.convertImage({ input, output, quality? })` | 格式转换,JPEG/WebP 质量 1-100 |
| `ffmpeg.compositeImage({ input, overlay, output, x?, y? })` | 叠加图片 |
| `ffmpeg.compressImage({ input, output, width?, quality? })` | 压缩,默认质量 70 |

### 兜底

| 函数 | 说明 |
| --- | --- |
| `ffmpeg.run(args[], options?)` | 任意参数运行 ffmpeg |
| `ffmpeg.runCommand("ffmpeg -i in.mp4 out.mp4")` | 原生命令字符串,任何 ffmpeg 能力都能用 |

非零退出码不抛错,由调用方判断:`result.exitCode !== 0` 时读 `result.stderr`。

## 任务配方

以下任务优先用高层函数,特殊需求走 `run`/`runCommand`。

### 读取媒体信息

```ts
const info = await ffmpeg.probe("input.mp4");
console.log(info.duration, info.videoStream?.width, info.audioStream?.codecName);
```

### 转码为常见格式

```ts
// MP4 → WebM
await ffmpeg.transcode({ input: "in.mp4", output: "out.webm", videoCodec: "libvpx", audioCodec: "libopus", overwrite: true });
// 转为 H.264 + AAC(兼容性最好)
await ffmpeg.transcode({ input: "in.mov", output: "out.mp4", videoCodec: "libx264", audioCodec: "aac", overwrite: true });
```

### 剪切片段

```ts
// 从 10 秒开始剪 5 秒,重编码(精确)
await ffmpeg.cut({ input: "in.mp4", output: "clip.mp4", start: "00:00:10", duration: "00:00:05", overwrite: true });
// 快剪(不重编码,速度快但关键帧处可能不准)
await ffmpeg.cut({ input: "in.mp4", output: "clip.mp4", start: "00:00:10", end: "00:00:20", copy: true, overwrite: true });
```

### 拼接视频

```ts
await ffmpeg.concat({ inputs: ["a.mp4", "b.mp4"], output: "merged.mp4", overwrite: true });
// 各片段编码一致时可快拼
await ffmpeg.concat({ inputs: ["a.mp4", "b.mp4"], output: "merged.mp4", copy: true, overwrite: true });
```

### 加水印

```ts
await ffmpeg.watermark({ input: "in.mp4", watermark: "logo.png", output: "out.mp4", position: "bottom-right", opacity: 0.8, overwrite: true });
```

### 转 GIF

```ts
await ffmpeg.toGif({ input: "in.mp4", output: "out.gif", width: 240, fps: 12 });
// 截取片段转 GIF
await ffmpeg.toGif({ input: "in.mp4", output: "out.gif", start: "00:00:01", duration: "00:00:03", width: 240 });
```

### 音频处理

```ts
await ffmpeg.toMp3({ input: "in.flac", output: "out.mp3" });              // 无损转 mp3
await ffmpeg.toFlac({ input: "in.mp3", output: "out.flac" });             // 转无损
await ffmpeg.setVolume({ input: "in.mp3", output: "loud.mp3", volume: 1.5 });
await ffmpeg.normalizeAudio({ input: "in.mp3", output: "norm.mp3" });     // 响度归一
await ffmpeg.joinAudio({ inputs: ["a.mp3", "b.mp3"], output: "merged.mp3" });
```

### 图片处理

```ts
await ffmpeg.resizeImage({ input: "big.png", output: "small.png", width: 800 });
await ffmpeg.cropImage({ input: "in.jpg", output: "out.jpg", width: 600, height: 400 });
await ffmpeg.convertImage({ input: "in.png", output: "out.webp", quality: 85 });
await ffmpeg.compressImage({ input: "in.jpg", output: "compressed.jpg", width: 1200, quality: 60 });
```

### 进度反馈

```ts
const info = await ffmpeg.probe("in.mp4");
await ffmpeg.transcode({
  input: "in.mp4", output: "out.mp4", videoCodec: "libx264",
  progressTotalMs: info.duration * 1000,
  onProgress: (p) => { if (p.percent !== undefined) console.log(`${p.percent.toFixed(1)}%`); },
  overwrite: true,
});
```

### 特殊需求用兜底

```ts
// 例:裁掉前 10 秒并加文字水印(无高层函数)
await ffmpeg.runCommand(`ffmpeg -ss 10 -i "${input}" -vf "drawtext=text='hello':x=10:y=10" -c:a copy "${output}"`);
```

## 陷阱清单

- **必须传 `overwrite: true`**(或 `-y`),否则输出文件已存在时 ffmpeg 交互询问会挂起。
- **端口/编码器常识**:WebM 配 `libvpx`+`libopus`,H.264 配 `libx264`+`aac`。别混搭。
- **`cut` 的 `copy: true` 不精确**:关键帧对齐问题,需求精确用默认重编码。
- **`concat` 的 `copy: true` 要求所有片段编码/分辨率一致**,否则花屏;不一致走默认重编码。
- **`run`/`runCommand` 不自动带 `-y`**;非零退出码不抛错,记得检查 `exitCode`。
- **`onProgress` 需要高层函数内部已带 `-progress pipe:1`**(已内置);底层 `run` 需自己加。
- **`timeoutMs` 超时会 SIGKILL 强杀**,任务不可恢复,别给太小的值。

## 无包降级

包不可用时,直接用系统 CLI。对应关系:

| 高层函数 | CLI 等价 |
| --- | --- |
| `probe` | `ffprobe -v error -print_format json -show_format -show_streams <input>` |
| `transcode` | `ffmpeg -i <in> -c:v <vc> -c:a <ac> -y <out>` |
| `cut` | `ffmpeg -ss <start> -i <in> -t <dur> -y <out>` |
| `concat` | `ffmpeg -i a -i b -filter_complex "concat=n=2:v=1:a=1" -map "[outv]" -map "[outa]" -y out` |
| `watermark` | `ffmpeg -i in -i logo -filter_complex "[1]format=rgba,colorchannelmixer=aa=0.8[wm];[0][wm]overlay=W-w-10:H-h-10" -y out` |
| `toGif` | `ffmpeg -i in -vf "fps=10,scale=240:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -y out.gif` |
| `toMp3` | `ffmpeg -i in -vn -c:a libmp3lame -b:a 192k -y out.mp3` |
| `resizeImage` | `ffmpeg -i in -vf "scale=800:-2" -y out.png` |

## 验证

- 每个函数返回 `{ exitCode, stderr, stdout, durationMs }`,处理成功 `exitCode === 0`。
- 用 `probe` 复核输出:`await ffmpeg.probe(output)` 检查 `duration`、`videoStream.width`、`codecName` 是否符合预期。
- 文件确实生成且大小 > 0。
