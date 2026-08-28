# @sakurachiyo0v0/bilibili

B 站视频下载 SDK。解析视频信息、获取播放流、可配置下载器下载,并用 `@sakurachiyo0v0/ffmpeg` 合并音视频。支持投稿视频、番剧、课程、B 站音乐,以及空间/收藏夹/合集/每周必看/稍后再看/历史记录等聚合类型。

> 核心逻辑参考开源项目 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader) 的下载引擎。

## 环境要求

- Node.js 20 或更高版本
- 下载并合并视频时需要系统已安装 `ffmpeg`(用于音视频合并)

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/bilibili@workspace:*
```

从 GitHub monorepo 使用(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本):

```yaml
allowBuilds:
  '@sakurachiyo0v0/bilibili@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
  '@sakurachiyo0v0/ffmpeg@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
```

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili"
```

## 快速开始

```ts
import { createBilibiliClient } from "@sakurachiyo0v0/bilibili";

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

## 扫码登录

CLI 弹出浏览器窗口扫码登录,自动收集 cookie 并持久化,无需手动复制:

```powershell
sc-bilibili login     # 打开浏览器窗口,用哔哩哔哩 App 扫码
sc-bilibili status    # 查看登录状态(不打印 cookie)
sc-bilibili logout    # 清除登录态
```

无头环境可用 `--no-browser`(仅打印扫码链接)与 `--timeout <sec>`(默认 180 秒)。登录后 `parse` / `streams` / `download` 自动使用存储的 cookie(高画质无需再传 `--cookie`);cookie 过期时自动用 refresh_token 续期。

CLI 浏览 UP 主视频列表(支持分页/排序/时长筛选):

```powershell
sc-bilibili space 39627524 --pn 2 --ps 20 --order click
# 按播放量排序取第 2 页;--order 支持 pubdate(默认)|click|favorite,--tid 按分区过滤

sc-bilibili space 39627524 --min-duration 120
# 只保留 120 分钟以上的长片(适合筛大型纪录片)
```

SDK 侧,`createBilibiliClient` 未传 `cookie` 时自动从登录态存储加载(显式 `cookie` 优先),可用 `authPath` 指定存储文件。

**登录态多端同步(可选):** 传 `remote`(配置中心加密命名空间)后登录态双写本地+远程,换机可还原:

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { AuthStore } from "@sakurachiyo0v0/account";

const remote = createConfigCenter().namespace("auth", { encrypt: true }); // /amechan/secrets/auth
// 新机还原:先 await new AuthStore({ platform: "bilibili", remote }).load() 拉取回写本地,再构造客户端
const client = createBilibiliClient({ remote });
// 远程不可达时自动降级本地,不影响使用
```

> 登录实现内聚于本包:扫码登录适配器 `bilibiliQrAdapter()` 复用 [`@sakurachiyo0v0/account`](../../account/README.md) 的通用底座(`qrcodeLogin` / `AuthStore` / 续期钩子),与网易云音乐共用同一套登录态管理逻辑。

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
  merge: true,               // 用 @sakurachiyo0v0/ffmpeg 合并音视频
});
```

## API

### `parse(url, options?)` → `MediaItem[]`

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

列表类解析(空间等)支持 `options`:

```ts
interface ListParseOptions {
  pn?: number;        // 页码,从 1 开始,默认 1
  ps?: number;        // 每页数量,默认 40,最大 50
  order?: string;     // 排序:pubdate(默认) | click(播放量) | favorite(收藏数)
  tid?: number;       // 分区过滤,0=全部
}

// 例:取 UP 主第 2 页、按播放量排序、只看 21(美食)分区
await client.parse("https://space.bilibili.com/39627524", { pn: 2, order: "click", tid: 21 });
```

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
  play?: number;          // 播放量(列表类解析)
  comment?: number;       // 评论数
  pubdate?: number;       // 发布时间(unix 秒)
  tid?: number;           // 分区 id
  description?: string;   // 简介
  chargingArc?: boolean;  // 是否充电专属视频
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

## 平台控制 API(收藏夹/关注/分组/互动,逐块扩展中)

SDK 在下载能力之外,按域提供**平台控制 API**(需登录,自动复用登录态/CSRF/续期)。当前已完成:

### 收藏夹管理(`client.fav`)

```ts
// 收藏夹管理
const mediaId = await bili.fav.createFolder({ title: "我的收藏", intro: "备注", privacy: 1 });
await bili.fav.editFolder(mediaId, { title: "新名字" });
await bili.fav.deleteFolder([mediaId1, mediaId2]);

// 收藏内容操作
await bili.fav.addVideo("170001", [mediaId]);            // 收藏视频到收藏夹(可多个)
await bili.fav.removeVideo("170001", [mediaId]);         // 取消收藏
await bili.fav.isFavoured("BV1xx411c7mD");               // 是否已收藏
await bili.fav.copyResources(srcId, tarId, [{ type: 2, id: 170001 }]); // 批量复制
await bili.fav.moveResources(srcId, tarId, [{ type: 2, id: 170001 }]); // 批量移动
await bili.fav.batchRemove(mediaId, [{ type: 2, id: 170001 }]);        // 批量删除内容
await bili.fav.cleanInvalid(mediaId);                    // 清空失效内容

// 查询
const folders = await bili.fav.listCreatedFolders(10086);   // 用户创建的收藏夹
const collected = await bili.fav.listCollectedFolders(10086); // 用户收藏的收藏夹
const info = await bili.fav.getFolderInfo(mediaId);        // 收藏夹元数据
const page = await bili.fav.listResources(mediaId, { pn: 1, ps: 20 }); // 内容明细
```

CLI:

```powershell
sc-bilibili fav list <mid>                 # 用户创建的收藏夹
sc-bilibili fav collected <mid>            # 用户收藏的收藏夹
sc-bilibili fav info <mediaId>             # 收藏夹元数据
sc-bilibili fav videos <mediaId>           # 收藏夹内容(--pn --ps)
sc-bilibili fav create <title> [--intro] [--private]
sc-bilibili fav edit <mediaId> <title> [--intro] [--private]
sc-bilibili fav delete <mediaIds...>
sc-bilibili fav add <rid> <mediaIds...>    # 收藏视频到收藏夹
sc-bilibili fav remove <rid> <mediaIds...> # 取消收藏
```

> 后续块(关注/分组/三连/评论/弹幕/动态/稍后再看/历史等)按 [`docs/superpowers/specs/2026-08-23-bilibili-control-apis-design.md`](../../docs/superpowers/specs/2026-08-23-bilibili-control-apis-design.md) 的清单逐块实现。

### 关注关系(`client.relation`)

```ts
await bili.relation.follow(14082);            // 关注
await bili.relation.unfollow(14082);          // 取关
await bili.relation.block(14082);             // 拉黑
await bili.relation.unblock(14082);           // 解除拉黑
await bili.relation.batchFollow([1, 2, 3]);   // 批量关注(返回失败的 mid)
const page = await bili.relation.listFollowings(10086, { pn: 1, ps: 50 }); // 关注列表
const fans = await bili.relation.listFollowers(10086);                    // 粉丝列表
const stat = await bili.relation.getStat(10086);                          // 关注/粉丝统计
const pair = await bili.relation.getRelation(14082);                      // 与某用户的关系
const map = await bili.relation.getRelations([1, 2]);                     // 批量关系
const blacks = await bili.relation.listBlacks();                          // 黑名单
const friends = await bili.relation.listFriends();                        // 互关列表
```

### 关注分组(`client.tag`)

```ts
const tags = await bili.tag.listTags();                      // 分组列表
const users = await bili.tag.listTagUsers(123);              // 分组内用户
const map = await bili.tag.getUserTags(14082);               // 用户所在分组
const tagid = await bili.tag.createTag("朋友");              // 创建分组
await bili.tag.renameTag(tagid, "好友");                     // 重命名
await bili.tag.deleteTag(tagid);                             // 删除分组
await bili.tag.addUsersToTags([14082], [tagid]);             // 用户加入分组
await bili.tag.removeUsersFromTags([14082]);                 // 移出分组(回默认分组)
await bili.tag.moveUsersToTags([14082], [oldTag], [newTag]); // 移动分组
```

### 视频互动(`client.interaction`,只读)

> 点赞/投币/一键三连等写操作属于 B 站刷量重灾区接口(风控最严、易触发人机验证,批量使用违反官方规则),本 SDK 不予提供。仅保留只读查询。

```ts
await bili.interaction.isLiked(170001);         // 是否(近期)点赞(aid 或 bvid)
```

### 评论(`client.comment`)

```ts
const page = await bili.comment.list(1, 170001, { pn: 1, ps: 20 }); // 评论列表(type 1=视频)
const rpid = await bili.comment.add(1, 170001, "前排");             // 发表评论
await bili.comment.add(1, 170001, "回复", { root: 100, parent: 100 }); // 回复评论
await bili.comment.del(1, 170001, rpid);        // 删除评论
await bili.comment.pin(1, 170001, rpid);        // 置顶评论(自己管理的评论区)
```

> 评论点赞/点踩已下线(刷量重灾区,同 `interaction` 说明)。

### 弹幕(`client.danmaku`)

```ts
await bili.danmaku.send(280001, "233", { progress: 1000, color: 16777215 }); // 发送弹幕(cid)
const items = await bili.danmaku.list(280001);   // 获取弹幕列表
```

### 动态(`client.dynamic`)

```ts
const dynId = await bili.dynamic.createText("hello", { atUids: ["14082"] }); // 发布纯文本动态
await bili.dynamic.del(dynId);                  // 删除动态
const newId = await bili.dynamic.repost(dynId, { content: "转发" }); // 转发
await bili.dynamic.pin(dynId);                  // 置顶动态
await bili.dynamic.unpin(dynId);                // 取消置顶
```

> 动态点赞/取消点赞已下线(刷量重灾区,同 `interaction` 说明)。

### 稍后再看 / 历史记录(`client.data`)

```ts
const list = await bili.data.listToView();       // 稍后再看列表
await bili.data.addToView(170001);              // 添加稍后再看
await bili.data.removeToView(170001);           // 移除
await bili.data.clearToView();                  // 清空稍后再看
const history = await bili.data.listHistory({ ps: 20 }); // 历史记录(游标翻页)
await bili.data.delHistory("archive_170001");   // 删除一条历史
await bili.data.clearHistory();                 // 清空历史记录
await bili.data.setHistoryEnabled(false);       // 停用历史记录
```

### 创作中心与追番(`client.creative`)

```ts
const archives = await bili.creative.listArchives({ pn: 1, ps: 10 }); // 稿件列表(含播放/点赞等统计)
const videos = await bili.creative.getArchiveVideos(170001);          // 稿件分P信息
await bili.creative.followSeason(41410);      // 追番/追剧(ssid)
await bili.creative.unfollowSeason(41410);    // 取消追番/追剧
```

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
└─ Merger → 调 @sakurachiyo0v0/ffmpeg 合并 mp4
```

新增内容类型 = 实现一个 `Parser` 并在 `client.ts` 注册,下载/合并流程完全复用。

## 验证命令

```powershell
pnpm --filter @sakurachiyo0v0/bilibili typecheck
pnpm --filter @sakurachiyo0v0/bilibili test
pnpm --filter @sakurachiyo0v0/bilibili build
```
