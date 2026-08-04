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
} from "@amechan/cli-utils";
import {
  createLlmClient,
  createProviderAdapter,
  listProviders,
  openaiAdapter,
} from "../index.js";

const USAGE = "Usage: amechan-llm <command> [options]";

const COMMANDS = [
  { name: "chat", desc: "Send a chat completion" },
  { name: "stream", desc: "Stream a chat completion" },
  { name: "providers", desc: "List OpenAI-compatible providers" },
  { name: "help", desc: "Show this help" },
];

const OPTIONS = [
  { flag: "--provider <id>", desc: "Provider id (openai/deepseek/groq/...) or adapter name" },
  { flag: "--api-key <key>", desc: "API key (or set env OPENAI_API_KEY etc.)" },
  { flag: "--model <name>", desc: "Model name" },
  { flag: "--prompt <text>", desc: "User prompt" },
  { flag: "--system <text>", desc: "System prompt" },
  { flag: "--json", desc: "Output raw JSON" },
];

function makeAdapter(provider: string, apiKey: string) {
  // 原生适配器(openai/anthropic/gemini/azure)用 openaiAdapter 的兼容方式处理 openai。
  if (provider === "openai") {
    return openaiAdapter({ apiKey });
  }
  // 注册表提供商。
  try {
    return createProviderAdapter(provider, apiKey);
  } catch {
    throw new CliError(
      `Unknown provider "${provider}". Native: openai/anthropic/gemini/azure. Registered: ${listProviders().join(", ")}`,
    );
  }
}

function resolveApiKey(provider: string, cliKey: string | undefined): string {
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  return cliKey ?? envKey ?? "";
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

    case "providers": {
      outputJson(listProviders());
      return;
    }

    case "chat": {
      const provider = requireString(args, "provider", "provider id");
      const model = requireString(args, "model", "model name");
      const prompt = requireString(args, "prompt", "prompt");
      const apiKey = resolveApiKey(provider, getString(args, "api-key"));
      if (apiKey === "") {
        throw new CliError(
          `No API key for provider "${provider}". Pass --api-key or set ${provider.toUpperCase()}_API_KEY`,
        );
      }
      const adapter = makeAdapter(provider, apiKey);
      const client = createLlmClient({ adapter });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (getString(args, "system") !== undefined) {
        messages.push({ role: "system", content: getString(args, "system")! });
      }
      messages.push({ role: "user", content: prompt });
      const result = await client.chat({ model, messages });
      if (getBool(args, "json")) {
        outputJson(result);
      } else {
        const content = result.choices[0]?.message.content;
        outputText(typeof content === "string" ? content : JSON.stringify(content ?? ""));
      }
      return;
    }

    case "stream": {
      const provider = requireString(args, "provider", "provider id");
      const model = requireString(args, "model", "model name");
      const prompt = requireString(args, "prompt", "prompt");
      const apiKey = resolveApiKey(provider, getString(args, "api-key"));
      if (apiKey === "") {
        throw new CliError(
          `No API key for provider "${provider}". Pass --api-key or set ${provider.toUpperCase()}_API_KEY`,
        );
      }
      const adapter = makeAdapter(provider, apiKey);
      const client = createLlmClient({ adapter });
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (getString(args, "system") !== undefined) {
        messages.push({ role: "system", content: getString(args, "system")! });
      }
      messages.push({ role: "user", content: prompt });
      let fullText = "";
      await client.chatStream({ model, messages }, (chunk) => {
        const text = chunk.choices[0]?.delta.content;
        if (typeof text === "string") {
          fullText += text;
          process.stdout.write(text);
        }
      });
      process.stdout.write("\n");
      return;
    }

    default:
      outputText(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      throw new CliError(`Unknown command: ${command}`, 2);
  }
}

main().catch(handleCliError);
