import "dotenv/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDemoConfig } from "./config.js";
import { createDemoServer } from "./server.js";

const config = readDemoConfig();
const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const server = createDemoServer({
  client: config.client,
  publicDirectory,
  ...(config.defaultFrom ? { defaultFrom: config.defaultFrom } : {}),
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Email demo: http://127.0.0.1:${config.port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await config.client.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
