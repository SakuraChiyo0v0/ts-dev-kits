/**
 * 本地 mock api.xiaoheihe.cn —— 真实 HTTP 协议路径测试。
 * 所有 handler 都断言签名参数(hkey/_time/nonce)存在,验证传输层注入。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockServerHandlers {
  onRequest?: (path: string, query: URLSearchParams) => void;
}

/** 启动 mock 服务器,返回 baseUrl 与关闭函数。 */
export async function startMockServer(handlers: MockServerHandlers = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let qrPolls = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const query = url.searchParams;

    // 签名参数断言(所有请求都应携带)
    if (!query.has("hkey") || !query.has("_time") || !query.has("nonce")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "error", msg: "missing signature params" }));
      return;
    }
    handlers.onRequest?.(path, query);

    const send = (payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(200, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };

    switch (path) {
      case "/account/get_qrcode_url/": {
        send({
          status: "ok",
          result: {
            qr_url: `${url.origin}/account/qr_login/?key=abc123&t=1`,
            expire: 180,
            error: "ok",
          },
        });
        break;
      }
      case "/account/qr_state/": {
        const key = query.get("key") ?? "";
        if (key === "abc123") {
          // 前两次等待,第三次成功(带 Set-Cookie)
          if (qrPolls < 2) {
            qrPolls += 1;
            send({ status: "ok", result: { error: "waiting", error_msg: "等待扫码" } });
          } else {
            res.setHeader("set-cookie", [
              "token_a=value_a; Path=/; HttpOnly",
              "token_b=value_b; Path=/; HttpOnly",
              "user_heybox_id=123456; Path=/",
            ]);
            send({ status: "ok", result: { error: "ok", error_msg: "ok", nickname: "测试用户" } });
          }
        } else {
          send({ status: "ok", result: { error: "expired", error_msg: "二维码已过期" } });
        }
        break;
      }
      case "/bbs/app/link/tree": {
        send({
          status: "ok",
          result: {
            comments: [
              {
                comment: [
                  {
                    commentid: 1001,
                    userid: 555,
                    text: "第一条评论",
                    floor_num: 1,
                    user: { username: "alice" },
                  },
                ],
              },
            ],
            total_page: 3,
            has_more_floors: 1,
            link: {
              title: "测试帖子",
              text: JSON.stringify([
                { text: "帖子正文段落一", type: "text" },
                { text: "https://img.example.com/a.png", type: "image", url: "https://img.example.com/a.png" },
              ]),
              topics: [{ name: "测试话题" }],
              hashtags: [{ name: "测试标签" }],
              user: { userid: 123, username: "poster" },
            },
          },
        });
        break;
      }
      case "/bbs/app/comment/sub/comments": {
        send({
          status: "ok",
          result: {
            has_more: false,
            lastval: 42,
            comments: [
              { commentid: 2001, userid: 666, text: "子评论一", user: { username: "bob" } },
            ],
          },
        });
        break;
      }
      case "/bbs/app/feeds": {
        if (query.get("captcha") === "1") {
          res.writeHead(200, { "content-type": "text/html" });
          res.end("<html>captcha verify ticket required</html>");
          return;
        }
        send({
          status: "ok",
          result: {
            links: [
              {
                linkid: 3001,
                title: "首页帖子一",
                description: "简介",
                topics: [{ name: "话题" }],
                hashtags: [{ name: "标签" }],
                user: { userid: "777" }, // 字符串 userid 漂移
              },
            ],
          },
        });
        break;
      }
      case "/bbs/app/user/message": {
        if (query.get("unauth") === "1") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "error", msg: "unauthorized" }));
          return;
        }
        send({
          status: "ok",
          result: {
            messages: [
              {
                comment_a_id: 4001,
                comment_a_text: "在吗?",
                message_id: 9001,
                root_comment_id: 0,
                linkid: 3001,
                userid_a: 888,
                user_a: { nickname: "召唤者" },
              },
            ],
          },
        });
        break;
      }
      case "/bbs/app/user/profile": {
        send({
          status: "ok",
          result: {
            user: { userid: 123, username: "poster", nickname: "发帖人" },
          },
        });
        break;
      }
      case "/bbs/app/comment/create": {
        // P1 写操作,mock 里不提供(合规边界)
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", msg: "write op not supported" }));
        break;
      }
      default: {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", msg: "not found" }));
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
