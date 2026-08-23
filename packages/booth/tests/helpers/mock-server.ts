/**
 * 本地 mock BOOTH 服务 —— 测试进程内起真实 HTTP 服务,模拟 BOOTH 端点。
 * 客户端通过 baseUrl 指向这里,全链路不碰线上。
 * 端点:商品页 / 用户订单页(登录校验)/ downloadables(302 → S3 直链)/ 文件 / 加购 cart。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** 商品 fixture。 */
export interface ItemFixture {
  id: string;
  title: string;
  priceYen: number;
  shopId: string;
  shopName?: string;
  alreadyOwned?: boolean;
  /** 免费商品 downloadables 链接(缺省按 /downloadables/<id>?variation_id=1 生成)。 */
  downloadUrl?: string;
  /** 简介/正文(JSON-LD description)。 */
  description?: string;
  /** 购买项列表(缺省按单购买项生成)。 */
  variations?: Array<{
    id: string;
    name: string;
    priceYen: number;
    downloadUrl?: string;
  }>;
  /** 控制商品页是否返回 404。 */
  notFound?: boolean;
  /** 控制是否返回登录页特征(未登录)。 */
  loginRequired?: boolean;
}

export interface MockBoothServer {
  /** 基地址,传给客户端 baseUrl。 */
  url: string;
  /** 关闭服务器。 */
  close: () => Promise<void>;
  /** 注册/替换商品 fixture。 */
  setItem: (fixture: ItemFixture) => void;
  /** 设置 downloadables 302 目标(S3 直链)。默认 302 → <base>/files/<id>.zip。 */
  setDownloadablesRedirect: (downloadableId: string, location: string) => void;
  /** 设置加购响应策略(默认 302 → <base>/carts)。 */
  setCartHandler: (
    handler: (body: Record<string, string>) => { kind: "ok" | "login-required" | "error"; status?: number },
  ) => void;
  /** 当前已收到的加购请求 body(测试断言用)。 */
  lastCartBody: () => Record<string, string> | null;
  /** 注册一个可下载的文件内容(按文件名)。 */
  setFileContent: (name: string, content: Buffer | string) => void;
}

export type CartResponse =
  | { kind: "ok" }
  | { kind: "login-required"; status?: number }
  | { kind: "error"; status?: number };

/** 构造商品页 HTML(内嵌 Product JSON-LD + csrf meta + 购买区)。 */
export function itemPageHtml(fixture: ItemFixture): string {
  const description =
    fixture.description ??
    (fixture.priceYen === 0 ? "Free asset for testing." : "Paid asset for testing.");
  const product = {
    "@type": "Product",
    name: fixture.title,
    description,
    offers: {
      "@type": "AggregateOffer",
      lowPrice: String(fixture.priceYen),
      highPrice: String(fixture.priceYen),
      priceCurrency: "JPY",
    },
    seller: {
      "@type": "Organization",
      identifier: fixture.shopId,
      ...(fixture.shopName !== undefined ? { name: fixture.shopName } : {}),
    },
  };

  // 购买项区块:多购买项按 fixture.variations;缺省按价格生成单个。
  const variations = fixture.variations ?? [
    {
      id: "1",
      name: fixture.title,
      priceYen: fixture.priceYen,
      ...(fixture.downloadUrl !== undefined
        ? { downloadUrl: fixture.downloadUrl }
        : fixture.priceYen === 0
          ? { downloadUrl: `/downloadables/${fixture.id}?variation_id=1` }
          : {}),
    },
  ];
  const variationsHtml = `<ul class="variations u-mt-300 border-b border-b-border300" id="variations">
${variations
  .map(
    (v, index) => `  <li class="variation-item border-t border-t-border300">
    <div class="flex">
      <div class="min-w-0 flex-[1]">
        <div class="flex">
          <div class="min-w-0 flex flex-col u-mr-500 flex-[1]">
            <div class="variation-name u-text-wrap">${v.name}</div>
            <div class="u-tpg-caption1 text-text-gray300">ダウンロード商品</div>
          </div>
          <div class="variation-price text-right">${v.priceYen > 0 ? `¥ ${v.priceYen.toLocaleString("en-US")}` : "¥ 0"}</div>
        </div>
      </div>
      <div class="variation-cart">
        <div class="cart-button-wrap">
${
  v.downloadUrl !== undefined
    ? `          <a class="btn rounded-oval add-cart full-length" href="${v.downloadUrl}">無料ダウンロード</a>`
    : `          <form class="button_to" method="post" action="https://${fixture.shopId}.booth.pm/cart?added_to_cart=true&amp;via=market">
            <input type="hidden" name="_method" value="patch" />
            <input type="hidden" name="cart_item[variation_id]" value="${v.id}" />
            <input type="hidden" name="authenticity_token" value="csrf-${fixture.id}" />
            <button type="submit">カートに入れる</button>
          </form>`
}
        </div>
      </div>
    </div>
  </li>`,
  )
  .join("\n")}
</ul>`;

  const buyArea = fixture.variations !== undefined || fixture.downloadUrl !== undefined
    ? variationsHtml
    : fixture.priceYen === 0
      ? `<a class="btn rounded-oval add-cart full-length" href="/downloadables/${fixture.id}?variation_id=1">無料ダウンロード</a>`
      : `<form class="button_to" method="post" action="https://${fixture.shopId}.booth.pm/cart?added_to_cart=true&amp;via=market">
           <input type="hidden" name="_method" value="patch" />
           <input type="hidden" name="cart_item[variation_id]" value="123" />
           <input type="hidden" name="authenticity_token" value="csrf-${fixture.id}" />
           <button type="submit">カートに入れる</button>
         </form>`;
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${fixture.title} - BOOTH</title>
  <meta name="csrf-token" content="csrf-${fixture.id}">
  <script type="application/ld+json">${JSON.stringify(product)}</script>
</head>
<body>
  <h1>${fixture.title}</h1>
  <div class="item-price">${fixture.priceYen > 0 ? `¥${fixture.priceYen}` : "無料"}</div>
  ${fixture.alreadyOwned === true ? '<div class="purchase-status">購入済み</div>' : ""}
  ${buyArea}
</body>
</html>`;
}

const LOGIN_PAGE_HTML = `<!doctype html>
<html><head><title>Login - accounts.booth.pm</title></head>
<body><form action="/login">login form</form></body></html>`;

/**
 * 创建 mock BOOTH 服务器。
 * 默认商品 fixture 集合为空;用 setItem 注册。
 */
export function createMockBoothServer(): Promise<MockBoothServer> {
  const items = new Map<string, ItemFixture>();
  const downloadablesRedirects = new Map<string, string>();
  const fileContents = new Map<string, Buffer>();
  let cartHandler: (body: Record<string, string>) => CartResponse = () => ({ kind: "ok" });
  let lastCartBody: Record<string, string> | null = null;
  let serverUrl = "";

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "GET" && /\/\w+\/items\/(\d+)$/.test(url.pathname)) {
      const match = /\/\w+\/items\/(\d+)$/.exec(url.pathname);
      const itemId = match?.[1] ?? "";
      const fixture = items.get(itemId);
      if (fixture === undefined || fixture.notFound === true) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><body>404 Not Found</body></html>");
        return;
      }
      if (fixture.loginRequired === true) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(LOGIN_PAGE_HTML);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(itemPageHtml(fixture));
      return;
    }

    if (method === "GET" && url.pathname === "/orders") {
      // 用户订单页(登录校验):带 cookie 返回订单页,否则返回登录页。
      const cookieHeader = req.headers["cookie"] ?? "";
      if (cookieHeader === "" || !/session/i.test(cookieHeader)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(LOGIN_PAGE_HTML);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><head><title>購入履歴</title></head><body><h1>購入履歴</h1></body></html>",
      );
      return;
    }

    if (method === "GET" && /\/downloadables\/[^?]+\?variation_id=\d+/.test(url.search ? url.pathname + url.search : url.pathname)) {
      // 免费下载:302 → S3 直链(或 mock 文件)。
      const match = /\/downloadables\/([^?]+)/.exec(url.pathname);
      const id = match?.[1] ?? "";
      const location = downloadablesRedirects.get(id) ?? `${serverUrl}/files/${id}.zip`;
      res.writeHead(302, { Location: location });
      res.end();
      return;
    }

    if (method === "POST" && url.pathname === "/cart" && url.searchParams.has("added_to_cart")) {
      let bodyText = "";
      req.on("data", (chunk: Buffer) => {
        bodyText += chunk.toString("utf-8");
      });
      req.on("end", () => {
        const body: Record<string, string> = {};
        for (const pair of bodyText.split("&")) {
          const eq = pair.indexOf("=");
          if (eq > 0) {
            const key = decodeURIComponent(pair.slice(0, eq));
            const value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
            body[key] = value;
          }
        }
        lastCartBody = body;
        const result = cartHandler(body);
        switch (result.kind) {
          case "ok":
            res.writeHead(302, { Location: `${serverUrl}/carts` });
            res.end();
            break;
          case "login-required":
            res.writeHead(result.status ?? 401, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "login required" }));
            break;
          case "error":
            res.writeHead(result.status ?? 422, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "cart error" }));
            break;
        }
      });
      return;
    }

    if (method === "GET" && url.pathname === "/carts") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><h1>カート</h1></body></html>");
      return;
    }

    if (method === "GET" && /\/files\/(.+)$/.test(url.pathname)) {
      const match = /\/files\/(.+)$/.exec(url.pathname);
      const name = match?.[1] !== undefined ? decodeURIComponent(match[1]) : "";
      const content = fileContents.get(name);
      if (content === undefined) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("file not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(content.byteLength),
        "Content-Disposition": `attachment; filename="${name}"`,
      });
      res.end(content);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve({
        url: serverUrl,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
        setItem: (fixture) => {
          items.set(fixture.id, fixture);
        },
        setDownloadablesRedirect: (downloadableId, location) => {
          downloadablesRedirects.set(downloadableId, location);
        },
        setCartHandler: (handler) => {
          cartHandler = handler;
        },
        lastCartBody: () => lastCartBody,
        setFileContent: (name, content) => {
          fileContents.set(name, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
        },
      });
    });
  });
}
