# bilibili UP 主空间解析修复与列表能力补齐 设计

状态:用户已批准(对话中确认「P0 + P1 功能补齐」范围)
日期:2026-08-28

## 1. 当前问题与目标

- 现状:
  - `SpaceParser` 读取 `/x/space/wbi/arc/search` 返回的 `data.vlist`,而真实接口结构是
    `data.list.vlist`,导致 `client.parse("space.bilibili.com/{mid}")` **永远静默返回空列表**,
    无任何报错;测试 mock 也按错误结构编写,测试全绿但真实接口全废。
  - 空间解析写死 `pn=1, ps=40`,无法翻页/排序(UP 主视频数超过 40 时拿不全)。
  - `MediaItem` 只有标题/封面/时长,缺少播放量、发布时间、分区等元数据,无法筛选"长片/爆款"。
  - CLI 无浏览 UP 主视频列表的命令,只能写脚本。
- 目标:修复空间解析 bug,补齐分页/排序/元数据/CLI 列表命令(本次只做 space,不做充电专属等 P2)。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| `client.parse("space.bilibili.com/39627524")` 返回 `[]`,无提示 | 返回真实视频列表;若接口异常抛 `BilibiliError` |
| 只能拿最新 40 条,无法翻页 | `parse(url, { pn, ps, order, tid })` 支持分页与排序 |
| 列表项无播放量/发布时间/分区 | `MediaItem` 增加 `play/danmaku/comment/favorites/pubdate/tid/tname/description` |
| 无 CLI 入口,只能写脚本 | `sc-bilibili space <mid> [--pn --ps --order --tid --min-duration]` |

## 3. 方案选择

### 方案 A:新建独立 `SpaceApi` 领域模块替代 parser(不采用)

- 优点:与 fav/relation 的 api 模块风格统一。
- 缺点:URL 解析入口(`client.parse`)已存在且是统一入口,再开 api 会造成双入口、
  语义分裂;空间页本质是"URL → 列表",归 parser 更自然。

### 方案 B:修 `SpaceParser` + 扩展 `MediaItem` 元数据 + `parse` 加 options + CLI `space`(采用)

- 优点:改动集中在一个 parser + 一个 CLI 命令,不动 api 分层;`parse(url, options?)`
  对所有 parser 签名一致,后续 favlist/collection 可复用同一 options。
- 缺点:`Parser` 接口签名变化需同步全部 parser 实现(改动面略大,但只是加可选参数)。

## 4. 仓库结构

```text
packages/bilibili/
├─ src/
│  ├─ types.ts           MediaItem 加元数据字段;新增 ListParseOptions;Parser.parse 加 options
│  ├─ parsers/aggregate.ts  SpaceParser 读 data.list.vlist + 元数据映射 + 分页/排序参数;其余 parser 签名适配
│  ├─ client.ts           parse(url, options?) 透传
│  ├─ cli/bilibili.ts     新增 space 命令 + OPTIONS 增项
│  └─ index.ts            导出 ListParseOptions 类型
├─ tests/parsers-v2.test.ts  修 mock 为真实结构 + 元数据/分页参数断言
├─ README.md              parse options 说明 + space 命令示例
└─ package.json           version 0.5.5 → 0.6.0(minor:新功能)
docs/packages-index.md   版本号同步
skills/bilibili-cli/SKILL.md  space 命令速查(守卫要求命令集一致)
```

## 5. 接口设计

```ts
/** 列表类解析选项(空间/收藏夹等分页列表)。 */
export interface ListParseOptions {
  /** 页码,从 1 开始,默认 1。 */
  pn?: number;
  /** 每页数量,默认 40,最大 50。 */
  ps?: number;
  /** 排序:pubdate(发布时间,默认) | click(播放量) | favorite(收藏数)。 */
  order?: string;
  /** 分区 tid 过滤,0=全部。 */
  tid?: number;
}

// MediaItem 新增(均可选,来自 arc/search vlist 实测字段):
//   play?: number        播放量
//   comment?: number     评论数
//   pubdate?: number     发布时间(unix 秒,接口字段 created)
//   tid?: number         分区 id(接口字段 typeid)
//   description?: string 简介
//   chargingArc?: boolean 是否充电专属视频(接口字段 is_charging_arc)

// Parser 接口:
//   parse(url: string, options?: ListParseOptions): Promise<MediaItem[]>;

// CLI:
//   sc-bilibili space <mid|space-url> [--pn N] [--ps N] [--order pubdate|click|favorite]
//                [--tid N] [--min-duration 分钟](本地过滤)
```

## 6. 错误码

无新增错误码。接口异常沿用 `BilibiliError`(API_ERROR / INVALID_URL),不再静默返回空列表。

## 7. 测试策略

- mock 改为真实结构 `{ list: { vlist: [...] } }`,vlist 条目带
  `play/pubdate/tid/tname/danmaku/comment/favorites/description`,断言映射;
- 断言 `parse(url, { pn: 2, ps: 10, order: "click" })` 发出的请求 query 带对应参数
  (经 `mock.requests` 检查);
- 真实账号冒烟:`sc-bilibili space 39627524 --min-duration 20`(人工验证)。

## 8. 验收条件

- [ ] `client.parse("space.bilibili.com/{mid}")` 返回真实视频列表(真实账号验证)
- [ ] `pn/ps/order/tid` 参数生效并被测试覆盖
- [ ] `MediaItem` 携带 play/pubdate 等元数据
- [ ] `sc-bilibili space <mid>` 可用,`--min-duration` 过滤生效
- [ ] `pnpm --filter @sakurachiyo0v0/bilibili typecheck && test` 全绿
- [ ] SKILL.md 命令集同步,`pnpm check`(含 skill 守卫)通过
