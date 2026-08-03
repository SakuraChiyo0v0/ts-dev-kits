import { afterEach, describe, expect, it } from "vitest";
import {
  createEmailClient,
  EmailError,
  smtpProvider,
  type SmtpProviderOptions,
} from "../src/index.js";
import {
  startTestSmtpServer,
  type TestSmtpServer,
} from "./helpers/smtp-test-server.js";

let server: TestSmtpServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("smtpProvider", () => {
  it.each([
    [{ host: "", port: 25, secure: false }, "host"],
    [{ host: "smtp.example.com", port: 0, secure: false }, "port"],
    [
      {
        host: "smtp.example.com",
        port: 25,
        secure: false,
        auth: { user: "", pass: "" },
      },
      "both user and pass",
    ],
  ])("rejects invalid SMTP configuration", (options, expectedMessage) => {
    expect(() => smtpProvider(options as SmtpProviderOptions)).toThrowError(expectedMessage);
  });

  it("verifies and sends HTML, text, recipients and an attachment over SMTP", async () => {
    server = await startTestSmtpServer();
    const client = createEmailClient({
      provider: smtpProvider({
        host: "127.0.0.1",
        port: server.port,
        secure: false,
      }),
    });

    await client.verify();
    const result = await client.send({
      from: { name: "Ame", address: "sender@example.com" },
      to: "to@example.com",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
      replyTo: "reply@example.com",
      subject: "SDK integration",
      text: "plain body",
      html: "<strong>html body</strong>",
      attachments: [
        {
          filename: "hello.txt",
          content: Buffer.from("attachment body"),
        },
      ],
    });

    expect(result.provider).toBe("smtp");
    expect(result.messageId).toBeTruthy();
    expect(result.accepted).toEqual(
      expect.arrayContaining([
        "to@example.com",
        "cc@example.com",
        "bcc@example.com",
      ]),
    );
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain("SDK integration");
    expect(server.messages[0]).toContain("hello.txt");
    expect(server.messages[0]).toContain(
      Buffer.from("attachment body").toString("base64"),
    );
    await client.close();
  });

  it("classifies authentication errors without exposing credentials", async () => {
    server = await startTestSmtpServer({
      user: "expected-user",
      pass: "expected-pass",
    });
    const secret = "do-not-leak-this-password";
    const client = createEmailClient({
      provider: smtpProvider({
        host: "127.0.0.1",
        port: server.port,
        secure: false,
        auth: { user: "wrong-user", pass: secret },
      }),
    });

    const error = await client.verify().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailError);
    expect(error).toMatchObject({ code: "AUTHENTICATION" });
    expect(String(error)).not.toContain(secret);
    await client.close();
  });
});
