import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createEmailClient, smtpProvider } from "@sakurachiyo0v0/email";
import type { EmailConfig } from "../config.js";
import { describeError } from "../errors.js";

/** email 包未配置 SMTP 时的统一错误(嵌套 object 缺省回退为 {} 而非 undefined)。 */
function smtpMissing(): Error {
  return new Error("email 工具未启用:请先在预设配置里填写 smtp(host/port/from, 可选 user/pass)并将 email.enabled 设为 true");
}

/** 从 config 取有效 SMTP 配置;未配置返回 undefined。 */
function resolveSmtp(config: EmailConfig): EmailConfig["smtp"] {
  const smtp = config.smtp;
  if (smtp === undefined || !smtp.host) return undefined;
  return smtp;
}

/** 注册 email 工具(verify / send)。SMTP 凭据只来自预设 config,不进模型可见内容。 */
export function applyEmailTools(ctx: Context, config: EmailConfig): () => void {
  const disposers: Array<() => void> = [];
  disposers.push(ctx.tools.register(defineTool({
    name: "email_verify",
    description: "校验 SMTP 连接与认证是否可用,不发送邮件。发信前建议先调用;失败会给出认证/连接类错误(消息脱敏)。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          detail: { type: "string" },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? "SMTP 连接与认证正常" : `SMTP 校验失败:${value.detail ?? "未知原因"}`,
      }],
    },
    async execute() {
      const smtp = resolveSmtp(config);
      if (smtp === undefined) throw smtpMissing();
      try {
        const client = createEmailClient({
          provider: smtpProvider({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            ...smtp.user !== undefined ? { auth: { user: smtp.user, pass: smtp.pass ?? "" } } : {},
          }),
        });
        try {
          await client.verify();
          return { ok: true };
        } finally {
          await client.close();
        }
      } catch (error) {
        return { ok: false, detail: describeError(error) };
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "email_send",
    description: "通过 SMTP 发送一封邮件(文本或 HTML,可带附件)。需要预设已配置 smtp;凭据不进模型可见内容。",
    parameters: {
      to: {
        type: "array",
        required: true,
        items: { type: "string" },
        description: "收件人邮箱列表",
      },
      subject: { type: "string", required: true, description: "邮件主题" },
      text: { type: "string", description: "纯文本正文(text 与 html 至少提供一个)" },
      html: { type: "string", description: "HTML 正文" },
      attachments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            filename: { type: "string", required: true },
            path: { type: "string", required: true, description: "附件文件路径" },
          },
        },
        description: "附件列表(文件路径)",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          messageId: { type: "string", required: true },
          accepted: { type: "array", items: { type: "string" }, required: true },
          rejected: { type: "array", items: { type: "string" }, required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `邮件已发送 (messageId=${value.messageId})` + (value.rejected.length > 0
          ? `\n部分收件人被拒绝:${value.rejected.join(", ")}`
          : ""),
      }],
    },
    async execute(args) {
      const smtp = resolveSmtp(config);
      if (smtp === undefined) throw smtpMissing();
      if (args.text === undefined && args.html === undefined) {
        throw new Error("text 与 html 至少提供一个");
      }
      try {
        const client = createEmailClient({
          provider: smtpProvider({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            ...smtp.user !== undefined ? { auth: { user: smtp.user, pass: smtp.pass ?? "" } } : {},
          }),
        });
        try {
          const result = await client.send({
            from: smtp.from,
            to: args.to,
            subject: args.subject,
            ...args.text !== undefined ? { text: args.text } : {},
            ...args.html !== undefined ? { html: args.html } : {},
            ...args.attachments !== undefined ? {
              attachments: args.attachments.map((attachment) => ({
                filename: attachment.filename,
                path: attachment.path,
              })),
            } : {},
          });
          return {
            messageId: result.messageId,
            accepted: result.accepted,
            rejected: result.rejected,
          };
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  return () => { for (const dispose of disposers) dispose(); };
}
