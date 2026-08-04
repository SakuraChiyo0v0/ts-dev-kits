# @amechan/bilibili

B 站视频下载 SDK。解析视频信息、获取播放流、可配置下载器下载,并用 `@amechan/ffmpeg` 合并音视频。支持投稿视频、番剧、课程、B 站音乐,以及空间/收藏夹/合集/每周必看/稍后再看/历史记录等聚合类型。

> 核心逻辑参考开源项目 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader) 的下载引擎。

## 环境要求

- Node.js 20 或更高版本
- 下载并合并视频时需要系统已安装 `ffmpeg`(用于音视频合并)

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @amechan/bilibili@workspace:*
```

从私有 GitHub monorepo 使用(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本):

```yaml
allowBuilds:
  '@amechan/bilibili@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
  '@amechan/ffmpeg@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
```

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili"
```

## 快速开始

```ts
import { createBilibiliClient } from "@amechan/bilibili";

const bili = createBilibiliClient({
  download: { concurrency: 4 },   // 4 线程并发下载
});

// 1. 解析视频(BV 号 → 分P 列表)
const items = await bili.parse("https://www.bilibili.com/video/BV1xx411c7mD");
console.log(items.map((item) => `${item.title} (cid=${item.cid})`));

// 2. 查看清晰度选项
const streams = await bili.getStreams(items[0]!, { quality: 80 });
console.log(`最高 ${streams.quality} 清晰度,${streams.videoStreams.length} 个视频流`);

// 3. 下载(自动下载音视频流 + ffmpeg 合并)
await bili.download(items[0]!, {
  outputDir: "./downloads",
  quality: 80,
  onProgress: (p) => console.log(`${p.stage}: ${p.percent.toFixed(1)}%`),
});
// → ./downloads/测试视频.mp4
```

## 下载器配置

```ts
createBilibiliClient({
  cookie: "SESSDATA=...; bili_jct=...",   // 登录后可下载高画质
  download: {
    concurrency: 4,          // 并发线程数(1=单线程)
    chunkSize: 4 * 1024 * 1024, // 分块大小
    retries: 5,              // 失败重试次数
    speedLimitMbps: 0,       // 限速,0 不限速
    resume: true,            // 断点续传
    filterPcdn: true,        // 过滤 pcdn/mcdn 劣质链接
    timeoutSeconds: 10,      // 请求超时
  },
  merge: true,               // 用 @amechan/ffmpeg 合并音视频
});
```

## API

### `parse(url)` → `MediaItem[]`

解析任意 B 站链接,返回媒体项列表。支持类型:

| 类型 | 链接示例 |
| --- | --- |
| 投稿视频 | `/video/BV...`、`/video/av...` |
| 番剧 | `/bangumi/play/ep...`、`/bangumi/play/ss...` |
| 课程 | `/cheese/play/ep...` |
| B站音乐 | `/audio/au...`(单曲)、`/audio/am...`(歌单) |
| UP主空间 | `space.bilibili.com/{mid}` |
| 收藏夹 | `medialist/detail/ml...` |
| 合集 | `space.bilibili.com/{mid}/lists/...` |
| 每周必看 | `v/popular/series/one?num=...` |
| 稍后再看 | `list/watchlater`(需登录) |
| 历史记录 | `account/history`(需登录) |

```ts
interface MediaItem {
  type: "video" | "bangumi" | ...;
  id: string;
  bvid?: string;
  cid?: number;
  pages?: { cid: number; page: number; part: string; duration: number }[];
  title: string;
  cover?: string;
  duration?: number;
  owner?: { mid: number; name: string };
  raw: unknown;
}
```

### `getStreams(item, { quality?, codec? })` → `PlayStream`

获取播放流(DASH 音视频分离)。`quality` 为目标清晰度,取不到自动降级;`codec` 可指定 `VideoCodec.AVC(7)` / `HEVC(12)` / `AV1(13)`。

```ts
interface PlayStream {
  quality: number;
  videoStreams: MediaStream[];
  audioStreams: MediaStream[];
  timelength?: number;
  dash: boolean;
}
interface MediaStream {
  id: number;
  codecId?: number;
  urls: string[];        // 按优先级排列的下载 URL
  bandwidth?: number;
  frameRate?: string;
  audio?: { id?: number; bandwidth?: number };
  raw: unknown;
}
```

### `download(item, options)` → `Promise<string>`

下载媒体项。自动:解析流 → 探测 CDN → 下载视频流 → 下载音频流(DASH)→ ffmpeg 合并。返回最终文件路径。

```ts
interface DownloadOptions {
  outputDir: string;
  filename?: string;          // 默认用标题
  quality?: number;
  codec?: VideoCodec;
  merge?: boolean;            // 覆盖客户端级配置
  onProgress?: (p: DownloadProgress) => void;
}
```

进度回调:`{ downloaded, total, percent, speed, stage: "video" | "audio" | "merging" }`。

## 清晰度参考

| 值 | 清晰度 |
| --- | --- |
| 127 | 8K |
| 126 | 杜比视界 |
| 125 | HDR |
| 120 | 4K |
| 116 | 1080P 60帧 |
| 112 | 1080P+ |
| 80 | 1080P |
| 64 | 720P |
| 32 | 480P |
| 16 | 360P |

> 基础清晰度(720P 及以下)无需登录;1080P+ / HDR / 杜比等需要登录 Cookie。

## 错误处理

统一 `BilibiliError`,错误码:

| 错误码 | 含义 |
| --- | --- |
| `NETWORK` | 网络请求失败 |
| `API_ERROR` | B 站 API 返回错误(含 `apiCode`) |
| `INVALID_URL` | 链接无效 |
| `LOGIN_REQUIRED` | 需要登录(高画质) |
| `DOWNLOAD_FAILED` | 下载失败(无可用 CDN/多次重试失败) |
| `MERGE_FAILED` | ffmpeg 合并失败 |
| `UNSUPPORTED_TYPE` | 内容类型未实现(第二版) |
| `UNKNOWN` | 未能分类 |

## 架构

```
createBilibiliClient()
├─ Parser 接口 → VideoParser(第一版)/ 其他类型(第二版)
├─ StreamResolver → DASH/MP4 取流 + 清晰度/编码选择
├─ Downloader → CDN 探测 + 并发分块下载 + 重试/断点续传/限速
└─ Merger → 调 @amechan/ffmpeg 合并 mp4
```

新增内容类型 = 实现一个 `Parser` 并在 `client.ts` 注册,下载/合并流程完全复用。

## 验证命令

```powershell
pnpm --filter @amechan/bilibili typecheck
pnpm --filter @amechan/bilibili test
pnpm --filter @amechan/bilibili build
```
