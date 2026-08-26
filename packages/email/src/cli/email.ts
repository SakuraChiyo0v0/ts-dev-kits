#!/usr/bin/env node
import {
  CliError,
  getBool,
  getString,
  handleCliError,
  outputJson,
  outputText,
  parseArgs,
  printHelp,
  requireString,
} from "@sakurachiyo0v0/cli-utils";
import { createEmailClient, smtpProvider } from "../index.js";

const USAGE = "Usage: sc-email <command> [options]";

const COMMANDS = [
  { name: "send", desc: "Send an email" },
  { name: "verify", desc: "Verify SMTP connection" },
  { name: "help", desc: "Show this help" },
];

const OPTIONS = [
  { flag: "--host <host>", desc: "SMTP host (or env SMTP_HOST)" },
  { flag: "--port <port>", desc: "SMTP port (or env SMTP_PORT)" },
  { flag: "--secure", desc: "Use TLS (or env SMTP_SECURE=true)" },
  { flag: "--user <user>", desc: "SMTP user (or env SMTP_USER)" },
  { flag: "--password <pass>", desc: "SMTP password (or env SMTP_PASSWORD)" },
  { flag: "--from <addr>", desc: "From address (or env SMTP_FROM)" },
  { flag: "--to <addr>", desc: "To address (comma separated)" },
  { flag: "--subject <text>", desc: "Email subject" },
  { flag: "--text <text>", desc: "Plain text body" },
  { flag: "--html <text>", desc: "HTML body" },
];

function readEnv(key: string): string | undefined {
  return process.env[key];
}

function makeClient(args: ReturnType<typeof parseArgs>) {
  const host = getString(args, "host") ?? readEnv("SMTP_HOST");
  const user = getString(args, "user") ?? readEnv("SMTP_USER");
  const password = getString(args, "password") ?? readEnv("SMTP_PASSWORD");
  const port = Number(getString(args, "port") ?? readEnv("SMTP_PORT") ?? 587);
  const secureEnv = readEnv("SMTP_SECURE");
  const secure = getBool(args, "secure") || secureEnv === "true";

  if (host === undefined || user === undefined || password === undefined) {
    throw new CliError("Missing SMTP config. Provide --host/--user/--password or set SMTP_HOST/SMTP_USER/SMTP_PASSWORD");
  }

  return createEmailClient({
    provider: smtpProvider({
      host,
      port,
      secure,
      auth: { user, pass: password },
    }),
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }
  const command = argv[0] ?? "";
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp(USAGE, COMMANDS, OPTIONS);
      return;

    case "verify": {
      const client = makeClient(args);
      await client.verify();
      outputJson({ ok: true, message: "SMTP connection verified" });
      return;
    }

    case "send": {
      const client = makeClient(args);
      const to = requireString(args, "to", "recipient address");
      const subject = requireString(args, "subject", "email subject");
      const text = getString(args, "text");
      const html = getString(args, "html");
      const from = getString(args, "from") ?? readEnv("SMTP_FROM") ?? requireString(args, "from", "from address");
      if (text === undefined && html === undefined) {
        throw new CliError("Provide --text or --html body");
      }
      const result = await client.send({
        from,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        ...(text !== undefined ? { text } : {}),
        ...(html !== undefined ? { html } : {}),
      });
      outputJson(result);
      await client.close();
      return;
    }

    default:
      outputText(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      throw new CliError(`Unknown command: ${command}`, 2);
  }
}

main().catch(handleCliError);
