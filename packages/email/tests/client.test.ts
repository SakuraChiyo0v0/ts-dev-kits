import { describe, expect, it, vi } from "vitest";
import {
  EmailError,
  createEmailClient,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from "../src/index.js";

const validMessage: EmailMessage = {
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Hello",
  text: "World",
};

function fakeProvider(): EmailProvider {
  return {
    name: "fake",
    verify: vi.fn(async () => undefined),
    send: vi.fn(async (): Promise<EmailSendResult> => ({
      provider: "fake",
      messageId: "message-1",
      accepted: ["recipient@example.com"],
      rejected: [],
      response: "250 queued",
    })),
    close: vi.fn(async () => undefined),
  };
}

describe("EmailClient", () => {
  it("delegates verify, send and close to the provider", async () => {
    const provider = fakeProvider();
    const client = createEmailClient({ provider });

    await client.verify();
    await expect(client.send(validMessage)).resolves.toMatchObject({
      provider: "fake",
      messageId: "message-1",
    });
    await client.close();

    expect(provider.verify).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledWith(validMessage);
    expect(provider.close).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...validMessage, from: "" }, "from"],
    [{ ...validMessage, to: [] }, "recipient"],
    [{ ...validMessage, subject: "" }, "subject"],
    [{ ...validMessage, text: undefined, html: undefined }, "text or html"],
  ])("rejects an invalid message before calling the provider", async (message, expected) => {
    const provider = fakeProvider();
    const client = createEmailClient({ provider });

    await expect(client.send(message as EmailMessage)).rejects.toMatchObject({
      name: "EmailError",
      code: "VALIDATION",
    });
    await expect(client.send(message as EmailMessage)).rejects.toThrow(expected);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("rejects CRLF header injection", async () => {
    const client = createEmailClient({ provider: fakeProvider() });
    await expect(
      client.send({
        ...validMessage,
        headers: { "X-Test": "ok\r\nBcc: victim@example.com" },
      }),
    ).rejects.toBeInstanceOf(EmailError);
  });
});
