import nodemailer, { type SendMailOptions } from "nodemailer";
import { EmailError, toEmailError } from "../../errors.js";
import type {
  EmailAddressList,
  EmailAttachment,
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "../../types.js";
import type { SmtpProviderOptions } from "./smtp-types.js";

function recipientText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "address" in value) {
    return String((value as { address: unknown }).address);
  }
  return String(value);
}

function validateOptions(options: SmtpProviderOptions): void {
  if (!options.host.trim()) {
    throw new EmailError("CONFIGURATION", "SMTP host is required");
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new EmailError("CONFIGURATION", "SMTP port must be between 1 and 65535");
  }
  if (options.auth && (!options.auth.user || !options.auth.pass)) {
    throw new EmailError("CONFIGURATION", "SMTP auth requires both user and pass");
  }
}

function mutableAddressList(value: EmailAddressList): SendMailOptions["to"] {
  if (typeof value === "string" || "address" in value) {
    return value;
  }
  return [...value];
}

function mailAttachment(attachment: EmailAttachment): NonNullable<SendMailOptions["attachments"]>[number] {
  return {
    filename: attachment.filename,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
    ...(attachment.cid ? { cid: attachment.cid } : {}),
    ...(attachment.path ? { path: attachment.path } : {}),
    ...(attachment.content ? { content: attachment.content } : {}),
  };
}

function mailOptions(message: EmailMessage): SendMailOptions {
  const headers = message.headers
    ? Object.fromEntries(
        Object.entries(message.headers).map(([name, value]) => [
          name,
          typeof value === "string" ? value : [...value],
        ]),
      )
    : undefined;

  return {
    from: message.from,
    subject: message.subject,
    ...(message.to !== undefined ? { to: mutableAddressList(message.to) } : {}),
    ...(message.cc !== undefined ? { cc: mutableAddressList(message.cc) } : {}),
    ...(message.bcc !== undefined ? { bcc: mutableAddressList(message.bcc) } : {}),
    ...(message.replyTo !== undefined
      ? { replyTo: mutableAddressList(message.replyTo) }
      : {}),
    ...(message.text !== undefined ? { text: message.text } : {}),
    ...(message.html !== undefined ? { html: message.html } : {}),
    ...(message.attachments ? { attachments: message.attachments.map(mailAttachment) } : {}),
    ...(headers ? { headers } : {}),
  };
}

export function smtpProvider(options: SmtpProviderOptions): EmailProvider {
  validateOptions(options);
  const secrets = [options.auth?.user ?? "", options.auth?.pass ?? ""];
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.tls ? { tls: options.tls } : {}),
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
    ...(options.maxConnections !== undefined
      ? { maxConnections: options.maxConnections }
      : {}),
    ...(options.maxMessages !== undefined ? { maxMessages: options.maxMessages } : {}),
    ...(options.connectionTimeoutMs !== undefined
      ? { connectionTimeout: options.connectionTimeoutMs }
      : {}),
    ...(options.greetingTimeoutMs !== undefined
      ? { greetingTimeout: options.greetingTimeoutMs }
      : {}),
    ...(options.socketTimeoutMs !== undefined
      ? { socketTimeout: options.socketTimeoutMs }
      : {}),
  });

  return {
    name: "smtp",
    async verify(): Promise<void> {
      try {
        await transport.verify();
      } catch (error) {
        throw toEmailError(error, secrets);
      }
    },
    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const info = await transport.sendMail(mailOptions(message));
        return {
          provider: "smtp",
          messageId: info.messageId,
          accepted: info.accepted.map(recipientText),
          rejected: info.rejected.map(recipientText),
          response: info.response,
        };
      } catch (error) {
        throw toEmailError(error, secrets);
      }
    },
    async close(): Promise<void> {
      transport.close();
    },
  };
}
