import {
  EmailError,
  createEmailClient,
  smtpProvider,
  type EmailClient,
} from "@amechan/email";

export interface DemoConfig {
  client: EmailClient;
  defaultFrom?: string;
  port: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new EmailError("CONFIGURATION", `${name} is required`);
  }
  return value;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new EmailError(
      "CONFIGURATION",
      `${name} must be an integer between 1 and 65535`,
    );
  }
  return parsed;
}

export function readDemoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  const secureValue = env.SMTP_SECURE?.trim().toLowerCase() ?? "true";
  if (secureValue !== "true" && secureValue !== "false") {
    throw new EmailError("CONFIGURATION", "SMTP_SECURE must be true or false");
  }

  const user = required(env, "SMTP_USER");
  const pass = required(env, "SMTP_PASSWORD");
  const defaultFrom = env.SMTP_FROM?.trim();

  return {
    client: createEmailClient({
      provider: smtpProvider({
        host: required(env, "SMTP_HOST"),
        port: integer(
          env.SMTP_PORT,
          secureValue === "true" ? 465 : 587,
          "SMTP_PORT",
        ),
        secure: secureValue === "true",
        auth: { user, pass },
      }),
    }),
    port: integer(env.EMAIL_DEMO_PORT, 4173, "EMAIL_DEMO_PORT"),
    ...(defaultFrom ? { defaultFrom } : {}),
  };
}
