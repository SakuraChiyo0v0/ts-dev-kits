import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Readable } from "node:stream";
import { FfmpegError } from "./errors.js";
import type {
  FfmpegOptions,
  FfmpegProgress,
  RunOptions,
  RunResult,
} from "./types.js";

function resolveBinary(path: string | undefined, fallback: string, label: string): string {
  const value = path?.trim();
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value.includes("/") || value.includes("\\") || value.endsWith(".exe")) {
    if (!existsSync(value)) {
      throw new FfmpegError("NOT_FOUND", `${label} binary not found at: ${value}`);
    }
  }
  return value;
}

/** 解析 ffmpeg `-progress pipe:1` 输出的 key=value 行。 */
export function parseProgressLines(
  lines: readonly string[],
  totalMs: number | undefined,
): FfmpegProgress[] {
  const events: FfmpegProgress[] = [];
  let current: Record<string, string> = {};

  const flush = (): void => {
    if (Object.keys(current).length === 0) {
      return;
    }
    const progress: FfmpegProgress = { raw: { ...current } };
    if (current.frame !== undefined) {
      progress.frame = Number(current.frame);
    }
    if (current.fps !== undefined) {
      progress.fps = current.fps;
    }
    if (current.bitrate !== undefined) {
      progress.bitrate = current.bitrate;
    }
    if (current.total_size !== undefined) {
      progress.totalSize = Number(current.total_size);
    }
    if (current.out_time_us !== undefined) {
      progress.outTimeUs = Number(current.out_time_us);
    }
    if (current.out_time_ms !== undefined) {
      progress.outTimeMs = Number(current.out_time_ms);
    }
    if (current.out_time !== undefined) {
      progress.outTime = current.out_time;
    }
    if (current.dup_frames !== undefined) {
      progress.dupFrames = Number(current.dup_frames);
    }
    if (current.drop_frames !== undefined) {
      progress.dropFrames = Number(current.drop_frames);
    }
    if (current.speed !== undefined) {
      progress.speed = current.speed;
    }
    if (totalMs !== undefined && totalMs > 0 && current.out_time_us !== undefined) {
      progress.percent = Math.min(100, Math.max(0, (Number(current.out_time_us) / 1000 / totalMs) * 100));
    }
    events.push(progress);
    current = {};
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    if (trimmed === "progress=end") {
      flush();
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (key === "progress" && value === "continue") {
      flush();
      continue;
    }
    current[key] = value;
  }
  flush();
  return events;
}

/** 把文本/流输入接到子进程 stdin。 */
async function writeInput(
  stdin: NodeJS.WritableStream,
  input: string | Buffer | Readable | undefined,
): Promise<void> {
  if (input === undefined) {
    stdin.end();
    return;
  }
  try {
    if (typeof input === "string" || Buffer.isBuffer(input)) {
      stdin.write(input);
      stdin.end();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      input.on("error", reject);
      input.pipe(stdin, { end: true });
      stdin.on("finish", resolve);
      stdin.on("error", reject);
    });
  } catch (error) {
    const destroyable = stdin as NodeJS.WritableStream & { destroy?: () => void };
    destroyable.destroy?.();
    throw error;
  }
}

/**
 * 运行一个 ffmpeg/ffprobe 进程并等待完成。
 * 非零退出码不会自动抛错,调用方可通过 `exitCode` 自行判断。
 */
export function runProcess(
  binary: string,
  options: RunOptions,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(binary, options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: RunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    const fail = (error: FfmpegError): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(error);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        fail(new FfmpegError("NOT_FOUND", `Binary not found: ${binary}`, { cause: error }));
        return;
      }
      fail(new FfmpegError("PROCESS_ERROR", `Failed to start ${binary}: ${error.message}`, {
        cause: error,
      }));
    });

    child.on("close", (code, signal) => {
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        return;
      }
      finish({ stdout, stderr, exitCode: code, durationMs });
      void signal;
    });

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        fail(
          new FfmpegError("TIMEOUT", `${binary} timed out after ${options.timeoutMs} ms`, {
            stderr,
          }),
        );
      }, options.timeoutMs);
    }

    void writeInput(child.stdin, options.input).catch((error: unknown) => {
      fail(new FfmpegError("PROCESS_ERROR", `Failed to write input: ${String(error)}`));
    });

    if (options.onProgress !== undefined) {
      let buffer = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        if (lines.length > 0) {
          for (const progress of parseProgressLines(lines, options.progressTotalMs)) {
            options.onProgress?.(progress);
          }
        }
      });
      child.stdout?.on("end", () => {
        if (buffer.length > 0) {
          for (const progress of parseProgressLines([buffer], options.progressTotalMs)) {
            options.onProgress?.(progress);
          }
        }
      });
    }
  });
}

/** 基于解析后的二进制路径创建进程运行器。 */
export function createRunner(options: FfmpegOptions): {
  ffmpegPath: string;
  ffprobePath: string;
  run: (args: string[], opts?: Omit<RunOptions, "args">) => Promise<RunResult>;
  runFfprobe: (args: string[], opts?: Omit<RunOptions, "args">) => Promise<RunResult>;
} {
  const ffmpegPath = resolveBinary(options.ffmpegPath, "ffmpeg", "ffmpeg");
  const ffprobePath = resolveBinary(options.ffprobePath, "ffprobe", "ffprobe");

  return {
    ffmpegPath,
    ffprobePath,
    run: (args, opts) => runProcess(ffmpegPath, { ...opts, args }),
    runFfprobe: (args, opts) => runProcess(ffprobePath, { ...opts, args }),
  };
}
