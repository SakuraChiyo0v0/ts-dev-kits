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

  verify(): Promise<void> {
    return this.#provider.verify();
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    assertMessage(message);
    return this.#provider.send(message);
  }

  close(): Promise<void> {
    return this.#provider.close();
  }
}

export function createEmailClient(options: CreateEmailClientOptions): EmailClient {
  return new EmailClient(options);
}
