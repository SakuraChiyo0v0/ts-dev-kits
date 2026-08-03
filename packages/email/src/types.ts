import type { Readable } from "node:stream";

export interface NamedEmailAddress {
  address: string;
  name?: string;
}
export type EmailAddress = string | NamedEmailAddress;
export type EmailAddressList = EmailAddress | readonly EmailAddress[];

export interface EmailAttachment {
  filename: string;
  contentType?: string;
  cid?: string;
  path?: string;
  content?: Buffer | Readable;
}

export interface EmailMessage {
  from: EmailAddress;
  to?: EmailAddressList;
  cc?: EmailAddressList;
  bcc?: EmailAddressList;
  replyTo?: EmailAddressList;
  subject: string;
  text?: string;
  html?: string;
  attachments?: readonly EmailAttachment[];
  headers?: Readonly<Record<string, string | readonly string[]>>;
}

export interface EmailSendResult {
  provider: string;
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

export interface EmailProvider {
  readonly name: string;
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<EmailSendResult>;
  close(): Promise<void>;
}

export interface CreateEmailClientOptions {
  provider: EmailProvider;
}
