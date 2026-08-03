import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createFfmpegClient } from "@amechan/ffmpeg";
import { createDemoServer } from "./server.js";

const port = Number(process.env.FFMPEG_DEMO_PORT ?? 4174);

const publicDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public",
);

const ffmpeg = createFfmpegClient({
  ...(process.env.FFMPEG_PATH ? { ffmpegPath: process.env.FFMPEG_PATH } : {}),
  ...(process.env.FFPROBE_PATH ? { ffprobePath: process.env.FFPROBE_PATH } : {}),
});

const server = createDemoServer({ ffmpeg, publicDirectory });

server.listen(port, "127.0.0.1", () => {
  console.log(`FFmpeg demo: http://127.0.0.1:${port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await new Promise<void>((resolveClose) =>
    server.close(() => resolveClose()),
  );
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
