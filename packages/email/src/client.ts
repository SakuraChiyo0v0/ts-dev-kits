import { createLogger } from "@sakurachiyo0v0/logger";
import { EmailError } from "./errors.js";
import type {
  CreateEmailClientOptions,
  EmailAddress,
  EmailAddressList,
  EmailAttachment,
  EmailMessage,
  EmailProvider,
  EmailSendResult,
} from "./types.js";

const logger = createLogger({ namespace: "email" }).child("client");

const hasNewline = (value: string): boolean => /[\r\n]/u.test(value);
const asList = (value?: EmailAddressList): readonly EmailAddress[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value as EmailAddress];

function assertAddress(value: EmailAddress, field: string): void {
  const address = typeof value === "string" ? value : value.address;
  if (!address.trim() || hasNewline(address)) {
    throw new EmailError("VALIDATION", `${field} contains an invalid address`);
  }
  if (typeof value !== "string" && value.name !== undefined && hasNewline(value.name)) {
    throw new EmailError("VALIDATION", `${field} contains an invalid display name`);
  }
}

function assertAttachment(attachment: EmailAttachment): void {
  if (!attachment.filename.trim() || hasNewline(attachment.filename)) {
    throw new EmailError("VALIDATION", "attachment filename is invalid");
  }
  if ((attachment.path === undefined) === (attachment.content === undefined)) {
    throw new EmailError(
      "VALIDATION",
      "attachment must provide exactly one of path or content",
    );
  }
}

function assertMessage(message: EmailMessage): void {
  assertAddress(message.from, "from");
  const recipients = [...asList(message.to), ...asList(message.cc), ...asList(message.bcc)];
  if (recipients.length === 0) {
    throw new EmailError("VALIDATION", "at least one recipient is required");
  }
  recipients.forEach((address) => assertAddress(address, "recipient"));
  asList(message.replyTo).forEach((address) => assertAddress(address, "replyTo"));
  if (!message.subject.trim() || hasNewline(message.subject)) {
    throw new EmailError("VALIDATION", "subject is required and cannot contain newlines");
  }
  if (message.text === undefined && message.html === undefined) {
    throw new EmailError("VALIDATION", "text or html content is required");
  }
  message.attachments?.forEach(assertAttachment);
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    const values = typeof value === "string" ? [value] : value;
    if (!name.trim() || hasNewline(name) || values.some(hasNewline)) {
      throw new EmailError("VALIDATION", "email headers cannot contain newlines");
    }
  }
}

export class EmailClient {
  readonly #provider: EmailProvider;

  constructor(options: CreateEmailClientOptions) {
    this.#provider = options.provider;
  }

  async verify(): Promise<void> {
    await this.#provider.verify();
    logger.debug("smtp connection verified");
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    assertMessage(message);
    // bcc 收件人不出现在日志(隐私语义);to/cc 计数即可,不记具体地址
    logger.info("sending email", {
      subject: message.subject,
      toCount: asList(message.to).length,
      ccCount: asList(message.cc).length,
      attachmentCount: message.attachments?.length ?? 0,
    });
    try {
      const result = await this.#provider.send(message);
      logger.info("email sent", {
        messageId: result.messageId,
        acceptedCount: result.accepted.length,
        rejectedCount: result.rejected.length,
      });
      return result;
    } catch (error) {
      logger.error("failed to send email", { subject: message.subject, error });
      throw error;
    }
  }

  close(): Promise<void> {
    return this.#provider.close();
  }
}

export function createEmailClient(options: CreateEmailClientOptions): EmailClient {
  return new EmailClient(options);
}
