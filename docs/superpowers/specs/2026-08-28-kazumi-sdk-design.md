# `@sakurachiyo0v0/kazumi` 番剧规则采集下载 SDK 设计

状态:用户已批准(2026-08-28;包名定为 `@sakurachiyo0v0/kazumi`;实现已完成,见 `packages/kazumi/`)
日期:2026-08-28

## 1. 当前问题与目标

- 现状:ts-dev-kits 已有 bilibili、netease-music 等「单平台全量封装」SDK,但每接入一个新番剧站都要写一个包(登录/请求/解析/下载全部重来),无法覆盖"各种网站的番剧"。开源项目 [Kazumi](https://github.com/Predidit/Kazumi)(Flutter 番剧采集播放器)证明了**声明式规则引擎**路径:换数据源不用写代码,改 JSON 规则即可,且规则靠 [KazumiRules](https://github.com/Predidit/KazumiRules) 仓库社区化维护。
- 目标:新增 `@sakurachiyo0v0/kazumi` 包 —— **Kazumi 规则格式兼容的番剧采集下载 SDK**。规则引擎(双模式:XPath 抓 HTML + API 模板抓 JSON)从 Kazumi 提炼移植,下载链路复用现有 `@sakurachiyo0v0/ffmpeg`(m3u8 分片下载 → 合并成 mp4)。配 CLI + DSH 工具,实现「搜索 → 选线路/集数 → 下载 mp4」一条龙。
- 本阶段范围:规则引擎 + 取流 + 下载 + CLI + 规则管理;不做播放器/弹幕/时间表(那是 Kazumi 的播放器侧,与下载无关)。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 每个番剧站要单独写 SDK 包 | 一个 `createAnimeClient()` 加载规则目录,搜索/下载任意已配置规则的站点 |
| 换站点 = 改代码 | 换站点 = 往规则目录放一个 JSON 规则文件 |
| 无统一番剧下载入口 | `sc-kazumi search <关键词>` / `sc-kazumi download <url>` |
| m3u8 分片处理零散 | SDK 内置 m3u8 解析/广告过滤/分片下载/ffmpeg 合并 |
| 规则质量无保障 | CLI `rules test` 本地试规则,直接看到 XPath/JSONPath 匹配片段与诊断 |

## 3. 方案选择

### 方案 A:直接集成 Kazumi 的 Dart 代码做二次开发(不采用)

- 优点:零移植成本,规则格式天然兼容。
- 缺点:Kazumi 是 Flutter 应用,Dart 生态与我们的 Node/TS monorepo 完全不兼容;集成 = 起一个 Dart 服务进程,违背"TS SDK"定位;Kazumi 规则含播放器专用字段(useWebview/useNativePlayer 等)与下载无关。

### 方案 B:移植 Kazumi 规则引擎到 TS,做独立包(采用)

- 优点:规则格式、字段语义、双模式执行、诊断追踪全部兼容 KazumiRules 生态;下载复用 `@sakurachiyo0v0/ffmpeg`,与 bilibili 下载链路一致;CLI/DSH 工具与仓库现有包模式统一。
- 缺点:需要自己实现 XPath 策略与受限 JSONPath(可参考 Kazumi 源码,但 Kazumi 是 MIT 协议,借鉴结构 + 自行实现;JSONPath 子集沙箱本身要自研)。
- 合规自洽:SDK 只含规则引擎,**不内置任何站点规则**;规则由用户从 KazumiRules 社区导入到自己的配置目录 —— 引擎中立,站点规则是用户自己的配置(用户已确认此边界)。

### 方案 C:只做下载,不做规则引擎(不采用)

- 优点:实现最简单。
- 缺点:每个站仍要手写取流代码,退化成方案 A 的痛点;没有规则引擎就失去"换站不换码"的核心价值。

## 4. 仓库结构

```text
packages/kazumi/
├─ src/
│  ├─ index.ts            公共出口:只导出稳定 API
│  ├─ types.ts            核心接口与枚举(Rule/SearchItem/Road/Episode 权威定义)
│  ├─ errors.ts           统一错误类 + 错误码
│  ├─ rules/              规则模型与加载
│  │  ├─ rule.ts          AnimeRule 模型(兼容 Kazumi JSON 字段)
│  │  ├─ loader.ts        规则目录扫描/加载/校验/去重
│  │  └─ validator.ts     规则校验(XPath/JSONPath 表达式合法性)
│  ├─ engine/             规则执行引擎
│  │  ├─ engine.ts        RuleEngine:search() / queryChapters()
│  │  ├─ xpath-strategy.ts  XPath 模式(cheerio + xpath 求值)
│  │  ├─ api-strategy.ts     API 模式(请求模板 + 受限 JSONPath)
│  │  └─ restricted-jsonpath.ts  受限 JSONPath 沙箱(安全子集)
│  ├─ request/            请求执行层
│  │  ├─ executor.ts      可注入的规则请求执行器(undici,UA/Referer/cookie)
│  │  └─ headers.ts       UA/Referer 头策略
│  ├─ stream/             取流与下载
│  │  ├─ m3u8.ts          m3u8 解析(master/media 检测/分片/EXT-X-KEY)
│  │  ├─ ad-filter.ts     discontinuity 分组广告过滤(参考 Kazumi M3u8AdFilter)
│  │  └─ download.ts      分片下载 + ffmpeg 合并成 mp4(复用 @sakurachiyo0v0/ffmpeg)
│  ├─ client.ts           上层门面:createAnimeClient()
│  └─ cli/                CLI 命令(sc-kazumi)
├─ tests/                 Vitest 测试(本地 mock 站点走真实协议路径)
├─ package.json           版本 / exports / scripts
└─ README.md              安装方式 / 规则格式 / API / 错误码
```

## 5. 接口设计

### 规则模型(Kazumi JSON 兼容,字段语义以 types.ts 为权威)

```ts
type RuleMode = "xpath" | "api";

interface AnimeRule {
  api: string;            // 规则 API 级别(兼容 Kazumi,如 "1")
  type: string;           // 站点类型,默认 "anime"
  name: string;           // 规则名(目录/去重主键,文件名 = 规则名)
  version: string;
  muliSources: boolean;   // 是否多线路
  userAgent: string;
  baseUrl: string;        // 站点根 URL
  searchURL: string;      // 搜索 URL,含 @keyword 占位符
  referer: string;
  // XPath 模式字段
  searchMode: RuleMode;   // 默认 "xpath"
  searchList: string;     // 搜索结果列表节点
  searchName: string;     // 标题 XPath
  searchResult: string;   // 详情页 URL XPath
  chapterMode: RuleMode;  // 默认 "xpath"
  chapterRoads: string;   // 线路列表 XPath
  chapterResult: string;  // 集数 XPath
  // API 模式字段(Kazumi searchApiConfig/chapterApiConfig)
  searchApiConfig?: ApiSearchConfig;
  chapterApiConfig?: ApiChapterConfig;
  // 反爬(可选;仅声明站点需要的头/cookie,不含验证码破解)
  antiCrawlerConfig?: AntiCrawlerConfig;
}

interface ApiRequestConfig {
  method: "GET" | "POST";
  url: string;             // 模板,支持 {keyword} / {source} 变量
  headers?: Record<string, string>;
  query?: Record<string, string>;
  bodyType?: "none" | "json" | "form";
  body?: unknown;
}

interface ApiSearchConfig {
  request: ApiRequestConfig;
  listPath: string;        // 结果列表 JSONPath
  namePath: string;        // 标题 JSONPath
  sourcePath: string;      // 详情页 URL JSONPath
}

interface ApiChapterConfig {
  request: ApiRequestConfig;
  format: "nested" | "delimited";
  roadsPath: string;
  roadNamePath: string;
  episodesPath: string;
  episodeNamePath: string;
  episodeUrlPath: string;
  // delimited 模式分隔符
  roadSeparator?: string;
  episodeSeparator?: string;
  fieldSeparator?: string;
}
```

### 统一数据模型

```ts
interface SearchItem { name: string; src: string; }     // 搜索结果(标题 + 详情页 URL)
interface Road { name: string; data: string[]; }        // 线路(线路名 + 集数页 URL 列表)
interface Episode { name: string; url: string; }        // 集数(名称 + 播放页 URL)
interface RuleTrace {                                  // 规则执行追踪(调试/测试用)
  rawResponse: string;
  matchedFragments: string[];
  diagnostics: string[];
}
```

### API 形状

```ts
// 客户端门面
createAnimeClient(options?: {
  rulesDir?: string;          // 规则目录,默认 <配置根>/amechan/kazumi/rules/
  fetchImpl?: typeof fetch;   // 可注入请求实现(测试用)
  download?: DownloadOptions; // 并发/重试/限速(透传 ffmpeg 与分片下载)
}): AnimeClient;

interface AnimeClient {
  // 规则管理
  rules: RuleManager;         // list() / load(name) / add(json) / remove(name) / validate(json)
  // 搜索:按关键词打所有已加载规则(或指定规则),返回聚合结果
  search(keyword: string, opts?: { rules?: string[] }): Promise<SearchItem[]>;
  // 详情:解析某条结果 → 线路列表
  getRoads(item: SearchItem): Promise<Road[]>;
  // 集数:线路 → 集数列表
  getEpisodes(item: SearchItem, road: Road): Promise<Episode[]>;
  // 下载单集:播放页 URL → 解析 m3u8 → 分片下载 + 合并 mp4
  download(episode: Episode, opts: {
    outputDir: string;
    onProgress?: (p: DownloadProgress) => void;
    adFilter?: boolean;       // 默认 true(discontinuity 分组广告过滤)
  }): Promise<{ filePath: string }>;
}
```

### CLI(`sc-kazumi`)

```text
sc-kazumi search <keyword> [--rule <name>]        # 搜索,JSON 输出
sc-kazumi roads <src-url>                          # 线路列表
sc-kazumi episodes <src-url>                       # 集数列表
sc-kazumi download <url> [--output-dir <dir>] [--no-ad-filter]  # 下载单集 mp4
sc-kazumi rules list|add <file>|remove <name>|validate <file>
sc-kazumi rules test <name> <keyword>             # 本地试规则,输出匹配片段/诊断
```

## 6. 错误处理

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `RULE_NOT_FOUND` | 规则不存在 | 请先 `sc-kazumi rules add` |
| `RULE_INVALID` | 规则 JSON/XPath/JSONPath 非法 | 用 `rules validate` 检查 |
| `NO_RESULT` | 搜索无结果 | 换关键词或检查规则是否失效 |
| `NETWORK` | 网络失败 | 检查网络/站点可达性 |
| `CAPTCHA` | 站点要求验证码 | 需浏览器手动验证(Kazumi 用 webview,SDK 只感知不规避) |
| `STREAM_PARSE_FAILED` | m3u8 解析失败 | 站点可能改版,检查规则 |
| `DOWNLOAD_FAILED` | 分片下载失败 | 重试或检查网络 |
| `MERGE_FAILED` | ffmpeg 合并失败 | 检查 ffmpeg 安装 |
| `UNKNOWN` | 其他 | 看日志 |

消息统一脱敏(不泄露 cookie/UA 敏感部分)。错误类型 `AnimeError`。

## 7. 测试策略

- **本地 mock 番剧站**:起一个本地 HTTP 服务器,提供搜索页(HTML)+ 剧集页 + 静态 m3u8 + 分片,规则指向 mock 站,走真实协议路径(XPath 解析/取流/下载/合并)。
- 覆盖:规则加载/校验、双模式搜索、线路解析、m3u8 master/media 检测、广告过滤、分片下载 + ffmpeg 合并、错误分支(NO_RESULT / CAPTCHA / 规则失效)。
- 受限 JSONPath 沙箱:非法表达式拒绝、恶意表达式(函数调用/递归)拒绝。
- m3u8 广告过滤:构造 discontinuity 多分组 playlist 验证过滤正确性。
- 写操作自清理:测试产出下载文件用临时目录,结束即删。

## 8. CLI 与 skill 同步

- 新增 `skills/kazumi-cli/SKILL.md`,覆盖 `sc-kazumi` 全部命令(搜索/线路/集数/下载/规则管理)。
- 规则 JSON 字段对照表以 `types.ts` 枚举为权威,skill 只引用。

## 8.1 DSH 工具(已实现)

- `@sakurachiyo0v0/dsh-sdk-tools` 新增 kazumi 工具:`kazumi_search` / `kazumi_roads` / `kazumi_download`,经 `ts-dev-kits` 预设按需暴露(默认开,设置页可关)。
- 工具开关双通道:预设 entry 配置(agent.cordis.yml)+ DSH 设置页 `dsh-sdk-tools` namespace;settings 页新增 kazumi 行。
- 下载工具支持取消中断(exec.signal.aborted);规则名缺省时从 URL host 推断,无法推断抛 `RULE_NOT_FOUND`。
- dsh-sdk-tools bump 至 0.5.0。

## 9. 版本与发布

- 首版 `0.1.0`(新包);按 `docs/package-template.md` 建骨架,更新 `docs/packages-index.md`。
- 依赖:复用 `@sakurachiyo0v0/ffmpeg`(workspace:*);新增 `cheerio`(HTML 解析)与 `jsonpath`(受限子集自行封装)。
- 发布到 GitHub Packages;发布后跑 `pnpm verify:published @sakurachiyo0v0/kazumi`。

## 10. 验收条件

- [x] `createAnimeClient()` + 规则目录加载跑通,本地 mock 站「搜索 → 线路 → 集数 → 下载 mp4」全链路成功
- [x] Kazumi 规则 JSON 直接导入可用(用 KazumiRules 仓库真实规则做导入兼容测试:AGE/DM84/ezdmw/dalvdm 4 条全部校验通过,含 antiCrawlerConfig 解析;规则本身由用户在配置里放)
- [x] 双模式(XPath/API)规则均可执行
- [x] 受限 JSONPath 沙箱拒绝恶意表达式
- [x] m3u8 广告过滤验证通过
- [x] 错误分支测试全绿(NO_RESULT/CAPTCHA/规则失效/下载失败)
- [x] README + packages-index + skill 同步完成
- [x] `pnpm check` 通过(RuleManager 补齐 add/remove,26 测试全绿)
- [x] 本地 pack 消费验证通过(`pnpm verify:kazumi-package`:ESM/CJS 导入 + CLI)
- [ ] 用户确认后提交推送,CI 发布成功,消费验证通过

## 11. 真实站点试跑发现与修复(2026-08-28 追加)

用户"先试跑"后接入真实 KazumiRules 规则验证,发现并修复:

- **搜索/线路/集数全部真实通过**:AGE、ezdmw 两个真实站点 XPath 规则工作正常(KazumiRules 规则直接导入可用)。
- **XPath 语义修复**:ezdmw 的 `chapterResult` 用 `/self::*[...]/following-sibling::a` 绝对轴相对路径,原实现只转 `//` 前缀导致匹配 0。已修复 `queryNodes`: `/` 与 `//` 前缀统一转 `.` / `.//`,保持 Kazumi"节点上执行"语义。
- **播放页取流解析层(新增 `stream/resolver.ts`)**:Kazumi 规则产出的 episode URL 多为播放页 HTML 而非 m3u8 直链。新增静态递归解析:直出 m3u8 → video/source 标签 → iframe 递归跟踪(深度上限 3)。纯 JS 动态取流站点(AGE iframe 解析站、ezdmw a_src)报 `STREAM_PARSE_FAILED` 并提示手动取直链——与 Kazumi 用 webview 执行 JS 的边界一致,静态实现不引入浏览器依赖。
- 测试:35 个全绿(+resolver 单测 8 个 + mock 播放页型下载端到端);`pnpm check` 全绿。
