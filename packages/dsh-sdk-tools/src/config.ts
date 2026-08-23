import z from "@deepseek-ai/schemastery";

// 输入侧类型:schemastery Config schema 的参数形状(全部字段可省略)。
// 输出侧类型:apply 收到的最终值(默认值已填充),见 ResolvedConfig。

/** SMTP 配置输入(host/from 必填才可用,user/pass 可选)。 */
export interface SmtpConfigInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

/** SMTP 配置输出(已填充默认值;host 非空才视为已配置)。 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** 插件配置输入(bilibili 包)。 */
export interface BilibiliConfigInput {
  enabled?: boolean;
  outputDir?: string;
}

/** bilibili 包配置输出。 */
export interface BilibiliConfig {
  enabled: boolean;
  outputDir: string;
}

/** 插件配置输入(netease-music 包)。 */
export interface NeteaseConfigInput {
  enabled?: boolean;
  outputDir?: string;
  level?: string;
}

/** netease-music 包配置输出。 */
export interface NeteaseConfig {
  enabled: boolean;
  outputDir: string;
  level: string;
}

/** 插件配置输入(ffmpeg 包)。 */
export interface FfmpegConfigInput {
  enabled?: boolean;
}

/** ffmpeg 包配置输出。 */
export interface FfmpegConfig {
  enabled: boolean;
}

/** 插件配置输入(email 包;smtp 缺省 = 未配置)。 */
export interface EmailConfigInput {
  enabled?: boolean;
  smtp?: SmtpConfigInput;
}

/** email 包配置输出。 */
export interface EmailConfig {
  enabled: boolean;
  smtp?: SmtpConfig;
}

/** 插件配置输入(lol 包)。 */
export interface LolConfigInput {
  enabled?: boolean;
}

/** lol 包配置输出。 */
export interface LolConfig {
  enabled: boolean;
}

/** 插件配置输入(schemastery 校验前)。 */
export interface Config {
  bilibili?: BilibiliConfigInput;
  netease?: NeteaseConfigInput;
  ffmpeg?: FfmpegConfigInput;
  email?: EmailConfigInput;
  lol?: LolConfigInput;
}

/** 插件配置输出(schemastery 填充默认值后,apply 收到即此形状)。 */
export interface ResolvedConfig {
  bilibili: BilibiliConfig;
  netease: NeteaseConfig;
  ffmpeg: FfmpegConfig;
  email: EmailConfig;
  lol: LolConfig;
}

export const Config: z<Config> = z.object({
  bilibili: z.object({
    enabled: z.boolean().default(true),
    outputDir: z.string().default("~/Downloads/bilibili"),
  }),
  netease: z.object({
    enabled: z.boolean().default(true),
    outputDir: z.string().default("~/Downloads/netease"),
    level: z.string().default("exhigh"),
  }),
  ffmpeg: z.object({
    enabled: z.boolean().default(true),
  }),
  email: z.object({
    enabled: z.boolean().default(false),
    smtp: z.object({
      host: z.string(),
      port: z.number().default(587),
      secure: z.boolean().default(false),
      user: z.string(),
      pass: z.string(),
      from: z.string(),
    }),
  }),
  lol: z.object({
    enabled: z.boolean().default(true),
  }),
});
