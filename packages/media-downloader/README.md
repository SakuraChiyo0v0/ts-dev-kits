# @sakurachiyo0v0/media-downloader

通用媒体下载 SDK：与具体平台无关。调用方负责拿到「最终媒体 URL + 文件名」，本包负责落盘到选定目录、流式下载（重试 + 进度）、元数据/封面写入、下载历史。

## 环境要求

- Node.js >= 20
- pnpm 11（workspace 内使用）

## 安装

workspace 内：

```json
"dependencies": {
  "@sakurachiyo0v0/media-downloader": "workspace:*"
}
```

## 快速开始

```ts
import { DownloadManager } from "@sakurachiyo0v0/media-downloader";

const manager = new DownloadManager({ root: "/downloads" });

// 列出可选的子目录（首项 "" 表示根目录）
const dirs = manager.listDirs(); // ["", "周杰伦", "欧美"]

// 下载一个目标
const result = await manager.download(
  {
    url: "http://m804.music.126.net/xxx.mp3",
    filename: "周杰伦 - 晴天.mp3",
    dir: "周杰伦",
    tags: { title: "晴天", artist: "周杰伦", album: "叶惠美" },
    coverUrl: "http://p1.music.126.net/xxx.jpg",
  },
  (p) => console.log(p.percent),
);

console.log(result.filePath); // /downloads/周杰伦/周杰伦 - 晴天.mp3

// 下载历史
manager.history();
manager.clearHistory();
```

## API

### `new DownloadManager(config)`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `root` | `string` | 是 | 下载根目录，所有落盘发生在其下 |
| `userAgent` | `string` | 否 | 请求媒体 URL 的 UA，默认一个桌面 UA |
| `retries` | `number` | 否 | 下载失败重试次数，默认 2 |

### `manager.download(target, onProgress?)`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `url` | `string` | 可直接 GET 的媒体地址 |
| `filename` | `string` | 完整文件名（含扩展名） |
| `dir` | `string?` | 相对 root 的子目录，空表示根目录 |
| `tags` | `{ title?, artist?, album? }?` | 写入媒体文件的标签 |
| `coverUrl` | `string?` | 封面图 URL，下载后内嵌 |

返回 `Promise<DownloadResult>`（`{ filePath }`）。

### `manager.listDirs()`

返回 `string[]`，首项 `""` 表示根目录，其余为相对子目录（递归到第 2 层）。

### `manager.history()` / `manager.clearHistory()`

下载历史（内存 + 持久化到 `root/.download-state.json`，最多 100 条）。

## 错误

统一 `DownloaderError`，错误码：

| code | 含义 |
| --- | --- |
| `INVALID_TARGET` | url 或 filename 缺失 |
| `DOWNLOAD_FAILED` | 下载失败（HTTP 非 2xx / 重试耗尽） |
| `EMPTY_BODY` | 响应体为空 |

## 验证

```bash
pnpm --filter @sakurachiyo0v0/media-downloader typecheck
pnpm --filter @sakurachiyo0v0/media-downloader test
pnpm --filter @sakurachiyo0v0/media-downloader build
```
