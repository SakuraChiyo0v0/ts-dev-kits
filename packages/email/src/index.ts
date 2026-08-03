export { EmailClient, createEmailClient } from "./client.js";
export {
  EmailError,
  redactSecrets,
  toEmailError,
  type EmailErrorCode,
} from "./errors.js";
export { smtpProvider } from "./providers/smtp/index.js";
export type {
  SmtpAuthOptions,
  SmtpProviderOptions,
  SmtpTlsOptions,
} from "./providers/smtp/index.js";
export type {
  CreateEmailClientOptions,
  EmailAddress,
  EmailAddressList,
  EmailAttachment,
  EmailMessage,
  EmailProvider,
  EmailSendResult,
  NamedEmailAddress,
} from "./types.js";
