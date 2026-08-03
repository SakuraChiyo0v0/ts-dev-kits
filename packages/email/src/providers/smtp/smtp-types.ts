export interface SmtpAuthOptions {
  user: string;
  pass: string;
}
export interface SmtpTlsOptions {
  rejectUnauthorized?: boolean;
  servername?: string;
  minVersion?: "TLSv1.2" | "TLSv1.3";
}

export interface SmtpProviderOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: SmtpAuthOptions;
  tls?: SmtpTlsOptions;
  pool?: boolean;
  maxConnections?: number;
  maxMessages?: number;
  connectionTimeoutMs?: number;
  greetingTimeoutMs?: number;
  socketTimeoutMs?: number;
}
