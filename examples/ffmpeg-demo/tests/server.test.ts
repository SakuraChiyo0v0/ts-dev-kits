import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFfmpegClient, type FfmpegClient } from "@amechan/ffmpeg";
import { createDemoServer, MAX_UPLOAD_BYTES } from "../src/server.js";

const ffmpeg: FfmpegClient = createFfmpegClient();

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  return address.port;
}

/** 生成一段真实的小视频并返回字节。 */
async function makeTestVideoBytes(): Promise<Buffer> {
  const directory = mkdtempSync(join(tmpdir(), "ffmpeg-demo-test-"));
  const videoPath = join(directory, "test.mp4");
  const createResult = await ffmpeg.run([
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=duration=1:size=96x64:rate=10",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    videoPath,
  ]);
  if (createResult.exitCode !== 0) {
    throw new Error(`Failed to create test video: ${createResult.stderr}`);
  }
  const bytes = readFileSync(videoPath);
  rmSync(directory, { recursive: true, force: true });
  return bytes;
}

describe("ffmpeg demo server", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
    server = undefined;
  });

  async function startServer(): Promise<string> {
    server = createDemoServer({
      ffmpeg,
      publicDirectory: resolve(process.cwd(), "public"),
    });
    const port = await listen(server);
    return `http://127.0.0.1:${port}`;
  }

  it("reports status with binary paths", async () => {
    const base = await startServer();
    const response = await fetch(`${base}/api/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(true);
  });

  it("rejects non-same-origin POST", async () => {
    const base = await startServer();
    const response = await fetch(`${base}/api/upload`, {
      method: "POST",
      headers: { origin: "http://evil.example.com" },
      body: "x",
    });
    expect(response.status).toBe(403);
  });

  it("uploads a generated video and probes it", async () => {
    const base = await startServer();
    const bytes = await makeTestVideoBytes();

    const response = await fetch(`${base}/api/upload`, {
      method: "POST",
      headers: {
        origin: base,
        "content-type": "application/octet-stream",
      },
      body: Uint8Array.from(bytes),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      info: { videoStream?: { width?: number }; duration: number };
    };
    expect(body.ok).toBe(true);
    expect(body.info.duration).toBeGreaterThan(0);
    expect(body.info.videoStream?.width).toBe(96);
  });

  it("rejects an upload over the size limit", async () => {
    const base = await startServer();
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    const response = await fetch(`${base}/api/upload`, {
      method: "POST",
      headers: {
        origin: base,
        "content-type": "application/octet-stream",
      },
      body: Uint8Array.from(oversized),
    });
    expect(response.status).toBe(400);
  });
});
