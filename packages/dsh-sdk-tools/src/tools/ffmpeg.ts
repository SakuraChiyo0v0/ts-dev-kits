import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";
import type { FfmpegConfig } from "../config.js";
import { describeError } from "../errors.js";

/** 注册 ffmpeg 工具(probe / transcode / extract_audio / thumbnail)。 */
export function applyFfmpegTools(ctx: Context, config: FfmpegConfig): () => void {
  const disposers: Array<() => void> = [];
  void config;

  disposers.push(ctx.tools.register(defineTool({
    name: "ffmpeg_probe",
    description: "用 ffprobe 读取媒体文件的元数据(格式/时长/码率/音视频流)。处理媒体文件前先调用它确认输入有效。",
    parameters: {
      input: {
        type: "string",
        required: true,
        description: "媒体文件路径",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          formatName: { type: "string", required: true },
          duration: { type: "number", required: true },
          size: { type: "number", required: true },
          streams: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                index: { type: "number", required: true },
                codecType: { type: "string", required: true },
                codecName: { type: "string", required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `格式: ${value.formatName}, 时长: ${value.duration.toFixed(2)}s, 大小: ${value.size} bytes\n流:\n`
          + value.streams.map((stream) => `- [${stream.index}] ${stream.codecType} / ${stream.codecName}`).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const ffmpeg = createFfmpegClient();
        const info = await ffmpeg.probe(args.input);
        return {
          formatName: info.formatName,
          duration: info.duration,
          size: info.size,
          streams: info.streams.map((stream) => ({
            index: stream.index,
            codecType: stream.codecType,
            codecName: stream.codecName,
          })),
        };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "ffmpeg_transcode",
    description: "用 ffmpeg 转码媒体文件(可指定视频/音频编码)。转码是长操作,可通过取消中断;已存在输出文件时默认覆盖。",
    parameters: {
      input: { type: "string", required: true, description: "输入文件路径" },
      output: { type: "string", required: true, description: "输出文件路径" },
      video_codec: { type: "string", description: "视频编码,如 libx264 / libvpx-vp9" },
      audio_codec: { type: "string", description: "音频编码,如 aac / libmp3lame" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          outputPath: { type: "string", required: true },
          durationMs: { type: "number", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `转码完成 → ${value.outputPath} (耗时 ${value.durationMs}ms)`,
      }],
    },
    async execute(args, exec) {
      try {
        const ffmpeg = createFfmpegClient();
        const result = await ffmpeg.transcode({
          input: args.input,
          output: args.output,
          overwrite: true,
          ...args.video_codec !== undefined ? { videoCodec: args.video_codec } : {},
          ...args.audio_codec !== undefined ? { audioCodec: args.audio_codec } : {},
          onProgress: () => {
            if (exec.signal.aborted) {
              throw new Error("CANCELLED: 转码已取消");
            }
          },
        });
        return { outputPath: args.output, durationMs: result.durationMs };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "ffmpeg_extract_audio",
    description: "从视频中提取音频(默认输出同目录同名 .mp3,可指定输出路径与编码)。长操作,可取消。",
    parameters: {
      input: { type: "string", required: true, description: "输入视频文件路径" },
      output: { type: "string", description: "输出音频路径;缺省为输入同目录同名 .mp3" },
      audio_codec: { type: "string", description: "音频编码,如 libmp3lame / aac" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          outputPath: { type: "string", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `音频已提取 → ${value.outputPath}`,
      }],
    },
    async execute(args, exec) {
      try {
        const ffmpeg = createFfmpegClient();
        const output = args.output ?? defaultAudioOutput(args.input);
        const result = await ffmpeg.extractAudio({
          input: args.input,
          output,
          overwrite: true,
          ...args.audio_codec !== undefined ? { audioCodec: args.audio_codec } : {},
          onProgress: () => {
            if (exec.signal.aborted) {
              throw new Error("CANCELLED: 提取已取消");
            }
          },
        });
        void result;
        return { outputPath: output };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "ffmpeg_thumbnail",
    description: "从视频提取一帧生成缩略图(默认取 1 秒处,输出同目录同名 .jpg)。",
    parameters: {
      input: { type: "string", required: true, description: "输入视频文件路径" },
      output: { type: "string", description: "输出图片路径;缺省为输入同目录同名 .jpg" },
      time: { type: "string", description: "取帧时间点,如 00:00:05 或 1.5;默认 00:00:01" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          outputPath: { type: "string", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `缩略图已生成 → ${value.outputPath}`,
      }],
    },
    async execute(args, exec) {
      try {
        const ffmpeg = createFfmpegClient();
        const output = args.output ?? defaultImageOutput(args.input);
        await ffmpeg.thumbnail({
          input: args.input,
          output,
          overwrite: true,
          ...args.time !== undefined ? { time: args.time } : {},
          onProgress: () => {
            if (exec.signal.aborted) {
              throw new Error("CANCELLED: 截图已取消");
            }
          },
        });
        return { outputPath: output };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  return () => { for (const dispose of disposers) dispose(); };
}

/** 输入视频 → 同目录同名 .mp3。 */
function defaultAudioOutput(input: string): string {
  return input.replace(/\.[^.]+$/, "") + ".mp3";
}

/** 输入视频 → 同目录同名 .jpg。 */
function defaultImageOutput(input: string): string {
  return input.replace(/\.[^.]+$/, "") + ".jpg";
}
