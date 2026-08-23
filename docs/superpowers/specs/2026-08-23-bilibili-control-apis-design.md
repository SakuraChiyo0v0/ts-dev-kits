# B 站平台控制能力 SDK 设计(收藏夹/关注/分组/互动/数据/创作域)

状态:清单全部块已完成(块 ①~⑧ 完整,块 ⑨ 实现稿件列表/分P/追番追剧,投稿上传不做)
日期:2026-08-23

## 1. 背景与目标

`@sakurachiyo0v0/bilibili` 目前是**纯下载 SDK**(parse → getStreams → download),只能读取收藏夹/稍后再看/历史记录等列表用于下载,没有任何"控制"(写)能力。用户目标:**覆盖尽可能全的 B 站平台控制能力**,包括收藏夹管理、关注/取关、关注分组、三连/评论/弹幕/动态、稍后再看/历史记录管理等。

**执行策略(用户明确要求):** 先立完整能力清单(本设计文档即清单),**每次只做一块**,逐块推进,每块完成后跑 typecheck + test + build 并更新文档,直到清单全部完成。

**参考项目(协议对照实现,不自研协议):**

- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)(接口文档权威来源)
- [Nemo2011/bilibili-api](https://github.com/Nemo2011/bilibili-api)(Python 全功能实现)
- 仓库内范式:`packages/netease-music/src/api/user.ts`(控制类 API 的模块化写法)

## 2. 通用设施扩展(所有块的共同前置)

### 2.1 `ApiSession` 增加 POST + CSRF 能力

现有 `ApiSession` 只有 GET(`get` / `getPlain` / `getRaw`)。控制类接口几乎全是 POST form 表单 + `csrf` 参数(cookie 中 `bili_jct`)。

**新增 `src/network.ts`:**

```ts
/** 从当前 cookie 中提取 bili_jct(CSRF Token);没有则返回 undefined。 */
csrf(): string | undefined;

/** POST application/x-www-form-urlencoded,自动注入 csrf,返回校验后的 data。 */
post<T = unknown>(url: string, params: Record<string, string | number>, options?: {
  csrf?: boolean;        // 自动附加 csrf,默认 true
  wbi?: boolean;         // 是否走 WBI 签名(GET 外少数 POST 需要),默认 false
}): Promise<T>;
```

- 校验走现有 `checkApiResponse`(复用 `#checkedJson` 的 -101 自动续期重试);
- `post` 需要 csrf 而 cookie 无 `bili_jct` 时抛 `LOGIN_REQUIRED`;
- `referer` 已固定 `https://www.bilibili.com/`,满足 `x/v3/fav/resource/deal` 等接口的 referer 校验;
- 注意 WBI 签名的 GET 与 POST 参数处理差异:POST 走 form body,不需要 `wts`/`w_rid`(收藏夹接口均不要求 WBI)。

### 2.2 客户端命名空间暴露

控制类 API 按域拆成独立模块类,统一作为 `BilibiliClient` 的**命名空间 getter** 暴露(参考 lol 包 `client.summoner` / `client.matchHistory` 模式),懒加载共享同一 `ApiSession`:

```ts
get fav(): FavApi;          // 第一块
// 后续:get relation(): RelationApi;  get tag(): TagApi;  ...
```

### 2.3 错误处理

沿用 `BilibiliError`,不加新错误码:`LOGIN_REQUIRED`(未登录/无 csrf)、`API_ERROR`(接口错误码透传)、`NOT_FOUND`(11010 内容不存在)、`NETWORK`。`checkApiResponse` 已把 apiCode 放进错误,保持现状即可。

## 3. 完整能力清单(roadmap,按块推进)

| 块 | 域 | 能力 | 接口(对照 bilibili-API-collect) | 状态 |
| --- | --- | --- | --- | --- |
| **①** | **收藏夹** | 创建/重命名/删除收藏夹;收藏/取消收藏视频;内容复制/移动/批量删除;清空失效;收藏夹列表/元数据/内容明细;是否已收藏 | `x/v3/fav/folder/add|edit|del`、`x/v3/fav/resource/deal`、`x/v3/fav/resource/copy|move|batch-del|clean`、`x/v3/fav/folder/info`、`x/v3/fav/folder/created/list-all`、`x/v3/fav/folder/collected/list`、`x/v3/fav/resource/list`、`x/v2/fav/video/favoured` | ✅ `FavApi` |
| **②** | **关注** | 关注/取关/批量关注;关注列表/粉丝列表;关注状态/关系统计;拉黑/解除拉黑 | `x/relation/modify`、`x/relation/batch/modify`、`x/relation/followings|followers`、`x/relation/stat`、`x/relation?fid=`、`x/relation/modify`(act 5/6) | ✅ `RelationApi` |
| **③** | **分组** | 关注分组列表;创建/重命名/删除分组;用户加入/移出分组;分组内用户列表;用户所在分组 | `x/relation/tags`、`x/relation/tag/create|modify|del`、`x/relation/tag/add|delUser`、`x/relation/tag?tag_id=`、`x/relation/tags?fid=` | ✅ `TagApi` |
| **④** | **互动-三连/收藏** | ~~点赞/取消赞~~;~~投币~~;~~一键三连~~;视频收藏状态 | ~~`x/web-interface/archive/like`、`x/web-interface/coin/add`、`x/web-interface/archive/like/triple`~~、`x/v2/fav/video/favoured` | ✅ `InteractionApi`(仅只读 `isLiked`;点赞/投币/三连写操作**已下线**:刷量重灾区接口,风控最严、批量使用违反官方规则) |
| **⑤** | **互动-评论** | 评论列表;发表/删除评论;~~评论点赞/取消~~;回复评论 | `x/v2/reply/main`、`x/v2/reply/add|del`、~~`x/v2/reply/action`~~ | ✅ `CommentApi`(评论点赞/点踩已下线,同 ④) |
| **⑥** | **互动-弹幕** | 发送弹幕;获取弹幕列表;弹幕屏蔽(高级弹幕) | `x/v2/dm/post`、`x/v1/dm/list.so`、`x/v2/dm/upd`(高级弹幕) | ✅ `DanmakuApi`(发送/获取;高级弹幕屏蔽待补) |
| **⑦** | **互动-动态** | 发布动态;删除动态;转发动态;~~动态点赞~~;动态列表;置顶 | `x/polymer/web-dynamic/v1/dynamic/create|remove|repost`、~~`x/polymer/web-dynamic/v1/like`~~、`x/polymer/web-dynamic/v1/feed/space` | ✅ `DynamicApi`(发布/删除/转发/置顶;动态点赞已下线,同 ④) |
| **⑧** | **数据-稍后再看/历史** | 稍后再看列表/添加/删除/清空;历史记录删除/清空 | `x/v2/history/toview/web|add|del|clear`、`x/v2/history/delete`、`x/v2/history/clear` | ✅ `DataApi` |
| **⑨** | **创作-投稿管理** | 稿件列表/编辑/删除;定时发布;追番/追剧管理 | 创作者中心接口(`x/creative/...` 等) | ✅ `CreativeApi`(稿件列表/分P/追番追剧;投稿上传与稿件编辑删除待补) |

> 体量提醒:①~③ 是用户最初点名的核心,④~⑧ 是"互动+数据"扩展,⑨ 涉及创作者中心,建议到最后独立评估。每块完成即回归验证 + 更新 README。

## 4. 第一块:收藏夹域(FavApi)详细设计

### 4.1 模块

新建 `src/api/fav.ts`(导出 `FavApi`),`src/api/index.ts` 汇总导出。`FavApi` 构造注入 `ApiSession`。

### 4.2 公开接口

```ts
class FavApi {
  // ---- 收藏夹管理 ----
  createFolder(opts: { title: string; intro?: string; privacy?: 0 | 1; cover?: string }): Promise<number>;  // 返回 media_id
  editFolder(mediaId: number | string, opts: { title?: string; intro?: string; privacy?: 0 | 1; cover?: string }): Promise<void>;
  deleteFolder(mediaIds: Array<number | string>): Promise<void>;

  // ---- 收藏内容操作 ----
  addVideo(rid: number | string, mediaIds: Array<number | string>): Promise<void>;    // 收藏视频到指定收藏夹
  removeVideo(rid: number | string, mediaIds: Array<number | string>): Promise<void>; // 取消收藏
  isFavoured(aidOrBvid: number | string): Promise<boolean>;
  copyResources(srcMediaId, tarMediaId, resources: FavResource[]): Promise<void>;      // 批量复制
  moveResources(srcMediaId, tarMediaId, resources: FavResource[]): Promise<void>;      // 批量移动
  batchRemove(mediaId, resources: FavResource[]): Promise<void>;                       // 批量删除内容
  cleanInvalid(mediaId: number | string): Promise<void>;                               // 清空失效内容

  // ---- 查询 ----
  getFolderInfo(mediaId: number | string): Promise<FavFolder>;                          // 收藏夹元数据
  listCreatedFolders(upMid: number | string, opts?: { type?: 0 | 2; rid?: number }): Promise<FavFolder[]>; // 用户创建的收藏夹
  listCollectedFolders(upMid: number | string, opts?: { pn?; ps? }): Promise<FavFolder[]>; // 用户收藏的收藏夹
  listResources(mediaId: number | string, opts?: { pn?; ps?; keyword?; order?; tid?; type? }): Promise<{ list: FavResourceItem[]; hasMore: boolean; info?: FavFolder }>;
}

/** 内容引用:视频稿件 { type: 2, id: avid } / 音频 { type: 12, id: auid } / 视频合集 { type: 21, id }。 */
interface FavResource { type: 2 | 12 | 21; id: number | string }
```

### 4.3 接口映射(bilibili-API-collect 对照)

| 方法 | 接口 | 参数 | 备注 |
| --- | --- | --- | --- |
| createFolder | `POST /x/v3/fav/folder/add` | title, intro, privacy(0公开/1私密), cover, csrf | 响应 data.id 为媒体 id |
| editFolder | `POST /x/v3/fav/folder/edit` | media_id, title, intro, privacy, cover, csrf | title 必传(保持原名) |
| deleteFolder | `POST /x/v3/fav/folder/del` | media_ids(逗号分隔), csrf | |
| addVideo | `POST /x/v3/fav/resource/deal` | rid, type=2, add_media_ids, csrf, platform=web | 多收藏夹逗号分隔 |
| removeVideo | `POST /x/v3/fav/resource/deal` | rid, type=2, del_media_ids, csrf, platform=web | |
| isFavoured | `GET /x/v2/fav/video/favoured` | aid | 返回 data.favoured |
| copyResources | `POST /x/v3/fav/resource/copy` | src_media_id, tar_media_id, mid, resources(`id:type,`逗号分隔), csrf | mid 从当前登录态(先取 cookie 的 DedeUserID,取不到抛 LOGIN_REQUIRED) |
| moveResources | `POST /x/v3/fav/resource/move` | 同上 | |
| batchRemove | `POST /x/v3/fav/resource/batch-del` | media_id, resources, csrf, platform=web | |
| cleanInvalid | `POST /x/v3/fav/resource/clean` | media_id, csrf | |
| getFolderInfo | `GET /x/v3/fav/folder/info` | media_id | 走 `getPlain` |
| listCreatedFolders | `GET /x/v3/fav/folder/created/list-all` | up_mid, type(0全部/2视频), rid | |
| listCollectedFolders | `GET /x/v3/fav/folder/collected/list` | up_mid, pn, ps, platform=web | |
| listResources | `GET /x/v3/fav/resource/list` | media_id, pn, ps, keyword, order, tid, type | 复用现有 FavlistParser 同款接口,返回分页 |

### 4.4 类型(`src/api/fav.ts` 内定义,index 导出)

```ts
interface FavFolder {
  id: number;            // mlid(完整 id)
  fid: number;           // 原始 id
  mid: number;           // 创建者 mid
  title: string;
  mediaCount: number;
  privacy: boolean;      // attr bit0:1=私有
  isDefault: boolean;    // attr bit1:1=默认收藏夹
  intro?: string;
  cover?: string;
  ctime?: number;
  mtime?: number;
  raw: unknown;
}

interface FavResourceItem {
  id: number;            // avid
  bvid: string;
  title: string;
  cover?: string;
  duration?: number;
  upper?: { mid: number; name: string };
  raw: unknown;
}
```

### 4.5 客户端接线

`client.ts`:`get fav(): FavApi`(懒加载 `this.#fav ??= new FavApi(this.#session)`)。`index.ts` 导出 `FavApi` + 类型。

### 4.6 CLI 子命令(`amechan-bilibili fav ...`)

```
amechan-bilibili fav list <mid>                # 用户创建的收藏夹
amechan-bilibili fav collected <mid>           # 用户收藏的收藏夹
amechan-bilibili fav info <mediaId>            # 收藏夹元数据
amechan-bilibili fav videos <mediaId>          # 收藏夹内容(支持 --pn --ps)
amechan-bilibili fav create <title> [--intro] [--private]
amechan-bilibili fav edit <mediaId> <title> [--intro] [--private]
amechan-bilibili fav delete <mediaId...>       # 逗号分隔多个
amechan-bilibili fav add <rid> <mediaIds...>   # 收藏视频到收藏夹
amechan-bilibili fav remove <rid> <mediaIds...># 取消收藏
```

需登录的子命令自动从 cookie/默认 AuthStore 取登录态(复用现有 `makeClient`),未登录报 `LOGIN_REQUIRED`。

### 4.7 测试

- `tests/fav.test.ts`:本地 mock HTTP 服务(复用 `tests/helpers/mock-api.ts` 模式,扩展支持 POST 读取 body):
  - 创建/编辑/删除收藏夹:参数正确性(csrf 注入、privacy 映射)、响应缺 id 抛错;
  - addVideo/removeVideo:`deal` 接口 add/del_media_ids 编码、referer 校验头;
  - copy/move/batchRemove:resources `id:type` 拼接、mid 自动解析(从 cookie DedeUserID);
  - 无 `bili_jct` 时写操作抛 `LOGIN_REQUIRED`;
  - 查询类:列表/元数据/内容分页映射。
- 复用 `ApiSession` 的 `post` 单测:`tests/network-post.test.ts`(csrf 注入、无 csrf 抛错、-101 续期重试在 POST 路径同样生效)。

## 5. 验证清单(完成标准)

- [x] `pnpm --filter @sakurachiyo0v0/bilibili typecheck && test && build` 通过;
- [x] 各域 API + CLI `fav|relation|tag` 子命令可用;
- [x] 真实登录态冒烟:`BILI_SMOKE=1 pnpm --filter @sakurachiyo0v0/bilibili test -- smoke`(11 项,收藏夹/关注/分组自清理写操作 + 评论/弹幕/动态/历史/创作只读);
- [x] README 增补"平台控制 API"章节;
- [x] 后续块在各自阶段独立验证。

**真实接口测试中修复的问题(记录):**

- `FavApi.addVideo/removeVideo/isFavoured` 传 bvid 时自动解析 avid(`/x/web-interface/view?bvid=`,原 `archive/stat` 接口已 404);
- `RelationApi.getRelation` 改用互相关系接口 `/x/space/wbi/acc/relation?mid=`(原 `/x/relation?fid=` 只返回单方向);`relation.attribute` 表示"当前用户→目标用户"的关注状态;
- `ApiSession` 基础 cookie(buvid3/buvid4)改为会话级固定生成,避免每次请求更换触发风控;
- B 站接口存在最终一致性(收藏/关注/分组写后立即读可能滞后),冒烟测试用轮询等待而非固定延迟。

**合规下线(2026-08-23):** 点赞/投币/一键三连(视频)、评论点赞/点踩、动态点赞/取消点赞属刷量重灾区接口,风控最严且批量使用违反 B 站官方规则,相关写操作全部从 SDK 移除,仅保留只读查询(`isLiked`、评论列表、收藏状态等)。

## 6. 明确不做(YAGNI)

- 多账号管理;cookie 系统级加密;手机号/密码登录(沿用扫码登录);
- 弹幕风控规避/自动刷量类操作(本 SDK 只做单账号普通操作);
- 创作者中心投稿上传(块 ⑨ 之前不做);
- 私信/直播/充电等边缘域(除非用户后续点名)。
