import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { EmailClient, type EmailProvider } from "@sakurachiyo0v0/email";
import { DownloadManager } from "@sakurachiyo0v0/media-downloader";
import { createBilibiliClient, parseUrl } from "@sakurachiyo0v0/bilibili";

async function main() {
  let verified = false, closed = false, delivered = 0;
  const provider: EmailProvider = {
    name: "local-test-double",
    async verify() { verified = true; },
    async close() { closed = true; },
    async send(message) { delivered++; assert.equal(message.subject, "consumer-smoke"); return { provider: this.name, messageId: "local-1", accepted: ["receiver@example.invalid"], rejected: [], response: "local accepted" }; },
  };
  const client = new EmailClient({ provider });
  await client.verify();
  const sent = await client.send({ from: "sender@example.invalid", to: "receiver@example.invalid", subject: "consumer-smoke", text: "local provider only" });
  assert.equal(sent.messageId, "local-1");
  await assert.rejects(client.send({ from: "sender@example.invalid", to: [], subject: "invalid", text: "x" }), { code: "VALIDATION" });
  await client.close(); assert(verified && closed && delivered === 1);
  console.log("PASS email: typed provider lifecycle, result and validation; no real email");

  let cardRequests = 0;
  const payload = Buffer.from("registry package local HTTP download");
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/x/web-interface/card") {
      cardRequests++; assert.equal(url.searchParams.get("mid"), "42");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: 0, data: { card: { mid: "42", name: "consumer-test", fans: 7, attention: 3, level_info: { current_level: 4 } } } }));
    } else { res.setHeader("content-length", payload.length); res.end(payload); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const root = join(process.cwd(), "artifacts"); mkdirSync(root, { recursive: true });
    const manager = new DownloadManager({ root, retries: 0 });
    const result = await manager.download({ url: `${baseUrl}/file`, filename: "smoke.txt", dir: "nested" });
    assert.deepEqual(readFileSync(result.filePath), payload);
    assert.equal(realpathSync(result.filePath), realpathSync(join(root, "nested", "smoke.txt")));
    assert(manager.history().some(item => item.status === "done"));
    assert(new DownloadManager({ root }).history().length > 0);
    console.log("PASS media-downloader: HTTP transfer, nested path, file bytes, persistent history");
    const bili = createBilibiliClient({ cookie: "", baseUrl, authPath: join(root, "unused-auth.json") });
    assert.equal(bili.isLoggedIn, false);
    assert.equal(parseUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=2").page, 2);
    const card = await bili.user.getCard(42);
    assert.equal(card.mid, 42); assert.equal(card.name, "consumer-test"); assert.equal(card.level, 4); assert.equal(cardRequests, 1);
    console.log("PASS bilibili: unauthenticated client, URL parse, local HTTP API and response mapping");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
