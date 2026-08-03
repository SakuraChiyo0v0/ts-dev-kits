import type { Readable } from "node:stream";

/** 创建 SDK 时的可选项。 */
export interface FfmpegOptions {
  /** ffmpeg 可执行文件路径或命令名,默认 `"ffmpeg"`(走系统 PATH)。 */
  ffmpegPath?: string;
  /** ffprobe 可执行文件路径或命令名,默认 `"ffprobe"`(走系统 PATH)。 */
  ffprobePath?: string;
}

/** 一次进程运行的进度快照,由 ffmpeg `-progress pipe:1` 输出解析而来。 */
export interface FfmpegProgress {
  frame?: number;
  fps?: string;
  bitrate?: string;
  totalSize?: number;
  outTimeUs?: number;
  outTimeMs?: number;
  outTime?: string;
  dupFrames?: number;
  dropFrames?: number;
  speed?: string;
  percent?: number;
  raw: Record<string, string>;
}

/** 底层 run 的可选项。 */
export interface RunOptions {
  args: string[];
  input?: string | Buffer | Readable;
  timeoutMs?: number;
  onProgress?: (progress: FfmpegProgress) => void;
  progressTotalMs?: number;
}

/** 一次进程运行的最终结果。 */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

/** 各高层函数共有的控制参数。 */
export interface RunControls {
  /** 已存在输出文件时传 `-y` 覆盖。 */
  overwrite?: boolean;
  timeoutMs?: number;
  onProgress?: (progress: FfmpegProgress) => void;
  progressTotalMs?: number;
}

/** ffprobe 输出中的一个媒体流。 */
export interface ProbeStream {
  index: number;
  codecType: string;
  codecName: string;
  codecLongName?: string;
  width?: number;
  height?: number;
  duration?: number;
  bitRate?: number;
  sampleRate?: number;
  channels?: number;
  language?: string;
  raw: Record<string, unknown>;
}

/** ffprobe 的整体结果。 */
export interface ProbeResult {
  formatName: string;
  formatLongName?: string;
  duration: number;
  size: number;
  bitRate?: number;
  streams: ProbeStream[];
  videoStream?: ProbeStream;
  audioStream?: ProbeStream;
  raw: unknown;
}

/** 缩放规格:只给宽或只给高时,另一维按原比例自动计算。 */
export interface ScaleSpec {
  width?: number;
  height?: number;
}

/** 转码选项。 */
export interface TranscodeOptions extends RunControls {
  input: string;
  output: string;
  videoCodec?: string;
  audioCodec?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  scale?: ScaleSpec;
}

/** 提取音频选项。 */
export interface ExtractAudioOptions extends RunControls {
  input: string;
  output: string;
  audioCodec?: string;
  audioBitrate?: string;
}

/** 提取单帧(截图)选项。 */
export interface ExtractFrameOptions extends RunControls {
  input: string;
  output: string;
  time?: string;
  scale?: ScaleSpec;
}

/** 生成缩略图选项。 */
export interface ThumbnailOptions extends RunControls {
  input: string;
  output: string;
  width?: number;
  time?: string;
}

/** 剪切片段选项。 */
export interface CutOptions extends RunControls {
  input: string;
  output: string;
  /** 起点,如 `"00:00:01"` 或 `"1.5"`,默认 `"00:00:00"`。 */
  start?: string;
  /** 绝对终点时间(与 `duration` 二选一)。 */
  end?: string;
  /** 相对时长,如 `"00:00:05"` 或 `"5"`(与 `end` 二选一)。 */
  duration?: string;
  /** 流复制模式(不重编码,快但可能不够精确)。默认 `false` 走重编码。 */
  copy?: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

/** 拼接多个片段选项。 */
export interface ConcatOptions extends RunControls {
  /** 待拼接的输入文件,按顺序。 */
  inputs: string[];
  output: string;
  /** 流复制模式(不重编码,要求所有片段编码参数一致)。默认 `false` 走重编码。 */
  copy?: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

/** 叠加图片水印选项。 */
export interface WatermarkOptions extends RunControls {
  input: string;
  /** 水印图片路径。 */
  watermark: string;
  output: string;
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  /** 水印不透明度 0–1,默认 `1`。 */
  opacity?: number;
}

/** 循环视频选项。 */
export interface LoopVideoOptions extends RunControls {
  input: string;
  output: string;
  /** 额外循环次数;`-1` 表示无限循环。 */
  loopCount?: number;
  /** 输出总时长,如 `"00:00:10"`(可选,配合 `loopCount` 截断)。 */
  outputDuration?: string;
}

/** 生成 GIF 选项。 */
export interface ToGifOptions extends RunControls {
  input: string;
  output: string;
  /** 抽帧帧率,默认 `10`。 */
  fps?: number;
  /** 缩放宽度,默认 `320`(高度按比例)。 */
  width?: number;
  /** 起始时间,如 `"00:00:01"`。 */
  start?: string;
  /** 处理时长,如 `"00:00:03"`。 */
  duration?: string;
}

/** 通用音频转换选项。 */
export interface ConvertAudioOptions extends RunControls {
  input: string;
  output: string;
  audioCodec?: string;
  audioBitrate?: string;
  channels?: number;
  sampleRate?: number;
}

/** 音量调整选项。 */
export interface SetVolumeOptions extends RunControls {
  input: string;
  output: string;
  /** 音量倍率(如 `1.5`)或 dB 值(如 `"3dB"`)。 */
  volume: number | string;
}

/** 响度归一化选项。 */
export interface NormalizeAudioOptions extends RunControls {
  input: string;
  output: string;
  /** 目标响度 LUFS,默认 `-16`。 */
  loudnessTarget?: number;
  /** 真实峰值 dBTP,默认 `-1.5`。 */
  truePeak?: number;
}

/** 合并多个音频选项。 */
export interface JoinAudioOptions extends RunControls {
  inputs: string[];
  output: string;
  audioCodec?: string;
  audioBitrate?: string;
}

/** 图片缩放选项。 */
export interface ResizeImageOptions extends RunControls {
  input: string;
  output: string;
  width?: number;
  height?: number;
}

/** 图片裁剪选项。 */
export interface CropImageOptions extends RunControls {
  input: string;
  output: string;
  width: number;
  height: number;
  /** 裁剪起始 x(默认居中)。 */
  x?: number;
  /** 裁剪起始 y(默认居中)。 */
  y?: number;
}

/** 图片格式转换选项。 */
export interface ConvertImageOptions extends RunControls {
  input: string;
  output: string;
  /** 质量(JPEG/WebP 的 1–100,默认 `90`)。 */
  quality?: number;
}

/** 图片合成(叠加)选项。 */
export interface CompositeImageOptions extends RunControls {
  /** 底图。 */
  input: string;
  /** 叠加图。 */
  overlay: string;
  output: string;
  /** 叠加图左上角 x。 */
  x?: number;
  /** 叠加图左上角 y。 */
  y?: number;
}

/** 图片压缩选项。 */
export interface CompressImageOptions extends RunControls {
  input: string;
  output: string;
  /** 目标宽度(可选,配合高度缩放压缩)。 */
  width?: number;
  /** 质量(JPEG/WebP 的 1–100,默认 `70`)。 */
  quality?: number;
}

/** 解析出的 SDK 客户端。 */
export interface FfmpegClient {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  /** 低层接口:以任意参数运行 ffmpeg。 */
  run(args: string[], options?: Omit<RunOptions, "args">): Promise<RunResult>;
  /** 低层接口:以任意参数运行 ffprobe。 */
  runFfprobe(args: string[], options?: Omit<RunOptions, "args">): Promise<RunResult>;
  /** 低层接口:以原生命令字符串运行,如 `ffmpeg -i in.mp4 out.mp4`。 */
  runCommand(command: string, options?: Omit<RunOptions, "args">): Promise<RunResult>;

  /** 读取媒体文件元数据。 */
  probe(input: string): Promise<ProbeResult>;
  /** 转码/重封装。 */
  transcode(options: TranscodeOptions): Promise<RunResult>;
  /** 提取音频轨。 */
  extractAudio(options: ExtractAudioOptions): Promise<RunResult>;
  /** 提取单帧为图片。 */
  extractFrame(options: ExtractFrameOptions): Promise<RunResult>;
  /** 生成缩略图。 */
  thumbnail(options: ThumbnailOptions): Promise<RunResult>;

  /** 视频:剪切片段。 */
  cut(options: CutOptions): Promise<RunResult>;
  /** 视频:拼接多个片段。 */
  concat(options: ConcatOptions): Promise<RunResult>;
  /** 视频:叠加图片水印。 */
  watermark(options: WatermarkOptions): Promise<RunResult>;
  /** 视频:循环。 */
  loopVideo(options: LoopVideoOptions): Promise<RunResult>;
  /** 视频:生成 GIF。 */
  toGif(options: ToGifOptions): Promise<RunResult>;

  /** 音频:通用格式转换。 */
  convertAudio(options: ConvertAudioOptions): Promise<RunResult>;
  /** 音频:转换为 MP3。 */
  toMp3(options: ConvertAudioOptions): Promise<RunResult>;
  /** 音频:转换为 FLAC(无损)。 */
  toFlac(options: ConvertAudioOptions): Promise<RunResult>;
  /** 音频:转换为 WAV。 */
  toWav(options: ConvertAudioOptions): Promise<RunResult>;
  /** 音频:转换为 OGG(Opus)。 */
  toOgg(options: ConvertAudioOptions): Promise<RunResult>;
  /** 音频:转换为 M4A(AAC)。 */
  toM4a(options: ConvertAudioOptions): Promise<RunResult>;
  /** 音频:调整音量。 */
  setVolume(options: SetVolumeOptions): Promise<RunResult>;
  /** 音频:响度归一化。 */
  normalizeAudio(options: NormalizeAudioOptions): Promise<RunResult>;
  /** 音频:合并多个文件。 */
  joinAudio(options: JoinAudioOptions): Promise<RunResult>;

  /** 图片:缩放。 */
  resizeImage(options: ResizeImageOptions): Promise<RunResult>;
  /** 图片:裁剪。 */
  cropImage(options: CropImageOptions): Promise<RunResult>;
  /** 图片:格式转换。 */
  convertImage(options: ConvertImageOptions): Promise<RunResult>;
  /** 图片:叠加合成。 */
  compositeImage(options: CompositeImageOptions): Promise<RunResult>;
  /** 图片:压缩。 */
  compressImage(options: CompressImageOptions): Promise<RunResult>;
}
