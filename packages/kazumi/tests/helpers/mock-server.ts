/**
 * 本地 mock 番剧站 —— 真实 HTTP 协议路径测试。
 *
 * 站点结构(与 KazumiRules 常见规则一致):
 * - /search?keyword=xxx          → 搜索结果 HTML(XPath 规则用)
 * - /search-api?keyword=xxx      → 搜索结果 JSON(API 规则用)
 * - /detail/<id>                 → 剧集页 HTML(线路 + 集数列表)
 * - /detail-api/<id>             → 剧集页 JSON(API 章节规则用)
 * - /playlist.m3u8               → 媒体播放列表(含 discontinuity 广告分组)
 * - /master.m3u8                 → master 播放列表(多码率)
 * - /seg_0.ts ... /seg_N.ts      → 分片(2 字节假数据)
 * - /ad_0.ts ... /ad_2.ts        → 广告分片
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export async function startMockServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const query = url.searchParams;

    const sendText = (body: string, contentType = "text/html; charset=utf-8") => {
      res.writeHead(200, { "content-type": contentType });
      res.end(body);
    };
    const sendJson = (payload: unknown) => {
      sendText(JSON.stringify(payload), "application/json");
    };
    const sendBytes = (bytes: number) => {
      res.writeHead(200, { "content-type": "video/mp2t" });
      res.end(Buffer.alloc(bytes, 0x61));
    };

    switch (path) {
      case "/search": {
        const keyword = query.get("keyword") ?? "";
        // XPath 规则目标:与 AGE 规则结构一致的列表页
        sendText(`<!DOCTYPE html><html><body><div><div><section>
          <div><div><div><div class="item"><div><div><h5><a href="/detail/101">${keyword} 第一季</a></h5></div></div></div></div>
          <div><div><div><div class="item"><div><div><h5><a href="/detail/102">${keyword} 剧场版</a></h5></div></div></div></div>
        </section></div></div></body></html>`);
        break;
      }
      case "/search-api": {
        const keyword = query.get("keyword") ?? "";
        sendJson({
          code: 0,
          data: [
            { id: 101, title: `${keyword} 第一季`, url: "/detail-api/101" },
            { id: 102, title: `${keyword} 剧场版`, url: "/detail-api/102" },
          ],
        });
        break;
      }
      case "/detail/101":
      case "/detail/102": {
        sendText(`<!DOCTYPE html><html><body>
          <div class="playlist"><ul>
            <li><a href="/playlist.m3u8">第1集</a></li>
            <li><a href="/master.m3u8">第2集</a></li>
            <li><a href="/play-page.html">第3集(播放页型)</a></li>
          </ul></div>
          <div class="playlist"><ul>
            <li><a href="/playlist.m3u8">线路2 第1集</a></li>
          </ul></div>
        </body></html>`);
        break;
      }
      case "/detail-api/101":
      case "/detail-api/102": {
        sendJson({
          code: 0,
          data: {
            roads: [
              {
                name: "线路1",
                episodes: [
                  { name: "第1集", url: "/playlist.m3u8" },
                  { name: "第2集", url: "/master.m3u8" },
                ],
              },
              {
                name: "线路2",
                episodes: [{ name: "第1集", url: "/playlist.m3u8" }],
              },
            ],
          },
        });
        break;
      }
      case "/play-page.html": {
        // 播放页型:HTML 含 <video> 标签指向 m3u8(模拟真实站点播放页)
        sendText(`<!DOCTYPE html><html><body>
          <video id="player" src="/playlist.m3u8" controls></video>
        </body></html>`);
        break;
      }
      case "/playlist.m3u8": {
        // 媒体播放列表:discontinuity 广告分组(3 个广告分片) + 主内容(2 个分片)
        sendText(
          [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            "#EXT-X-TARGETDURATION:10",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXTINF:4.000,",
            "/ad_0.ts",
            "#EXTINF:4.000,",
            "/ad_1.ts",
            "#EXTINF:4.000,",
            "/ad_2.ts",
            "#EXT-X-DISCONTINUITY",
            "#EXTINF:10.000,",
            "/seg_0.ts",
            "#EXTINF:10.000,",
            "/seg_1.ts",
            "#EXT-X-ENDLIST",
          ].join("\n"),
          "application/vnd.apple.mpegurl",
        );
        break;
      }
      case "/master.m3u8": {
        sendText(
          [
            "#EXTM3U",
            "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=720x480",
            "/media-low.m3u8",
            "#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080",
            "/media-high.m3u8",
          ].join("\n"),
          "application/vnd.apple.mpegurl",
        );
        break;
      }
      case "/media-low.m3u8":
      case "/media-high.m3u8": {
        sendText(
          [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            "#EXT-X-TARGETDURATION:10",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXTINF:10.000,",
            "/seg_0.ts",
            "#EXTINF:10.000,",
            "/seg_1.ts",
            "#EXT-X-ENDLIST",
          ].join("\n"),
          "application/vnd.apple.mpegurl",
        );
        break;
      }
      case "/seg_0.ts":
      case "/seg_1.ts":
        sendBytes(64);
        break;
      case "/ad_0.ts":
      case "/ad_1.ts":
      case "/ad_2.ts":
        sendBytes(16);
        break;
      default:
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
