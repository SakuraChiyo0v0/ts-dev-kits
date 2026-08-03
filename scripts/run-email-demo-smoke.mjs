import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { SMTPServer } from "smtp-server";

const host = "127.0.0.1";
const username = `smoke-${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("base64url");
let received = 0;

const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS"],
  onAuth(auth, _session, callback) {
    if (auth.username === username && auth.password === password) {
      callback(null, { user: username });
      return;
    }
    callback(new Error("Invalid smoke credentials"));
  },
  onData(stream, _session, callback) {
    stream.on("data", () => undefined);
    stream.on("end", () => {
      received += 1;
      console.log(JSON.stringify({ event: "message-received", received }));
      callback();
    });
    stream.on("error", callback);
  },
});

const listen = (server, port) =>
  new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListen);
  });

const freePort = async () => {
  const probe = createServer();
  await listen(probe, 0);
  const address = probe.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a smoke-test port");
  }
  const port = address.port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
};

await listen(smtp, 0);
const smtpAddress = smtp.server.address();
if (!smtpAddress || typeof smtpAddress === "string") {
  throw new Error("SMTP smoke server has no TCP address");
}

const webPort = await freePort();
const demo = spawn(
  process.execPath,
  [resolve("node_modules/tsx/dist/cli.mjs"), "examples/email-demo/src/index.ts"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SMTP_HOST: host,
      SMTP_PORT: String(smtpAddress.port),
      SMTP_SECURE: "false",
      SMTP_USER: username,
      SMTP_PASSWORD: password,
      SMTP_FROM: "Smoke Demo <smoke@example.test>",
      EMAIL_DEMO_PORT: String(webPort),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

const url = `http://${host}:${webPort}`;
let ready = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`${url}/api/status`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // The child process is still starting.
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}

if (!ready) {
  demo.kill();
  smtp.close();
  throw new Error("Email demo smoke server did not become ready");
}

console.log(JSON.stringify({ event: "ready", url, pid: process.pid }));

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  demo.kill();
  smtp.close(() => process.exit(0));
};

demo.once("exit", (code) => {
  if (!shuttingDown) {
    console.error(`Email demo exited unexpectedly with code ${String(code)}`);
    shutdown();
  }
});
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
