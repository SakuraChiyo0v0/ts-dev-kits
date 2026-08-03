export type EmailErrorCode =
  | "CONFIGURATION"
  | "VALIDATION"
  | "AUTHENTICATION"
  | "CONNECTION"
  | "DELIVERY"
  | "UNKNOWN";

export class EmailError extends Error {
  readonly code: EmailErrorCode;

  constructor(code: EmailErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmailError";
    this.code = code;
  }
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
}

function errorRecord(error: unknown): Record<string, unknown> {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : {};
}

export function toEmailError(
  error: unknown,
  secrets: readonly string[] = [],
): EmailError {
  if (error instanceof EmailError) {
    return error;
  }
  const record = errorRecord(error);
  const sourceMessage = error instanceof Error ? error.message : "Unknown email error";
  const message = redactSecrets(sourceMessage, secrets);
  const code = String(record.code ?? "");
  const responseCode = Number(record.responseCode ?? 0);

  if (code === "EAUTH" || code === "ENOAUTH") {
    return new EmailError("AUTHENTICATION", message, { cause: error });
  }
  if (
    [
      "ECONNECTION",
      "EDNS",
      "ESOCKET",
      "ETIMEDOUT",
      "ETLS",
      "EREQUIRETLS",
    ].includes(code)
  ) {
    return new EmailError("CONNECTION", message, { cause: error });
  }
  if (
    code === "EENVELOPE" ||
    code === "EMESSAGE" ||
    code === "ESTREAM" ||
    responseCode >= 400
  ) {
    return new EmailError("DELIVERY", message, { cause: error });
  }
  return new EmailError("UNKNOWN", message, { cause: error });
}
