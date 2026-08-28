# @sakurachiyo0v0/kazumi

Kazumi 规则格式兼容的番剧采集下载 SDK：**声明式规则引擎(XPath 抓 HTML + API 模板抓 JSON 双模式)+ m3u8 下载合并成 mp4**。

规则格式与 [Kazumi](https://github.com/Predidit/Kazumi) / [KazumiRules](https://github.com/Predidit/KazumiRules) 生态兼容——换数据源不用写代码,改 JSON 规则即可。SDK 本身**不内置任何站点规则**,规则由用户导入到自己的规则目录(引擎中立)。

**适用环境：** Node.js 20+；下载合并 mp4 需系统安装 `ffmpeg`(通过 `@sakurachiyo0v0/ffmpeg`)。

## 安装方式

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/kazumi@workspace:*
```

从 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/kazumi`、`@sakurachiyo0v0/ffmpeg` 构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/kazumi"
```

## 快速开始

```ts
import { createAnimeClient } from "@sakurachiyo0v0/kazumi";

// 规则目录默认 <配置根>/amechan/kazumi/rules/
const client = createAnimeClient();

// 1. 搜索(结果带 [规则名] 前缀)
const items = await client.search("药屋少女的呢喃");

// 2. 查线路
const roads = await client.getRoads(items[0]!);

// 3. 线路 → 集数
const episodes = await client.getEpisodes(items[0]!, roads[0]!);

// 4. 下载单集 mp4
const { filePath } = await client.download(episodes[0]!, {
  outputDir: "./downloads",
  rule: "AGE",          // 该集所属的规则名
  onProgress: (p) => console.log(p.downloadedBytes, p.speed),
});
console.log("保存到:", filePath);
```

## 规则目录

- 默认 `<配置根>/amechan/kazumi/rules/`,每个规则一个 `<规则名>.json`(文件名 = 规则名)。
- 配置根解析统一来自 `@sakurachiyo0v0/config`(唯一权威):Windows `%APPDATA%`(回退 `AppData/Roaming`)、macOS `~/Library/Application Support`、Linux `$XDG_CONFIG_HOME` 或 `~/.config`;`AMECHAN_CONFIG_HOME` 可覆盖。
- 环境变量 `AMECHAN_KAZUMI_RULES_DIR` 可覆盖规则目录。
- **规则来源**:从 [KazumiRules](https://github.com/Predidit/KazumiRules) 下载 `<name>.json` 后 `sc-kazumi rules add` 导入,或手写。SDK 不内置规则。

### WebDAV 多端同步(可选)

`createAnimeClient({ sync: true })` 开启规则 WebDAV 同步(经 `@sakurachiyo0v0/config` 的 `namespace("kazumi")`,加密存储于云端 `/amechan/secrets/kazumi/`):

- **双写**:`rules.add` / `rules.remove` 本地 + WebDAV 同时写入,换机器自动拉取;
- **远端优先**:`rules.load` / 搜索前先同步远端规则到本地缓存;
- **优雅回退**:无全局配置(`sc-config setup` 未执行)/网络失败时,同步自动关闭,规则仅本地,不报错;
- 前置:先执行 `sc-config setup` 配置 WebDAV 全局配置(见 `@sakurachiyo0v0/config` README)。

### 规则 JSON 格式(兼容 Kazumi)

**XPath 模式**(抓 HTML 页面):

```json
{
  "api": "1",
  "name": "站点名",
  "baseURL": "https://example.com/",
  "searchURL": "https://example.com/search?kw=@keyword",
  "searchList": "//div[2]/div/section/div/div/div/div",
  "searchName": "//div/div[2]/h5/a",
  "searchResult": "//div/div[2]/h5/a",
  "chapterRoads": "//div[2]/div/section/div/div[2]/div[2]/div[2]/div",
  "chapterResult": "//ul/li/a"
}
```

- `searchList` / `chapterRoads` 绝对 XPath;`searchName` / `searchResult` / `chapterResult` 相对列表项(`//x` 在节点上等价 `.//x`)。
- `searchURL` 的 `@keyword` 占位符替换为编码后的关键词。
- 可选:`userAgent`、`referer`、`muliSources`、`antiCrawlerConfig`(`enabled`/`captchaDetectValue`)。

**API 模式**(请求模板 + JSONPath):

```json
{
  "name": "API站",
  "baseURL": "https://api.example.com",
  "searchMode": "api",
  "chapterMode": "api",
  "searchApiConfig": {
    "request": { "method": "GET", "url": "/search?kw={keyword}" },
    "listPath": "$.data[*]",
    "namePath": "$.title",
    "sourcePath": "$.url"
  },
  "chapterApiConfig": {
    "request": { "method": "GET", "url": "{source}" },
    "roadsPath": "$.data.roads[*]",
    "roadNamePath": "$.name",
    "episodesPath": "$.episodes[*]",
    "episodeNamePath": "$.name",
    "episodeUrlPath": "$.url"
  }
}
```

- JSONPath 仅支持受限安全子集:`$`、`.key`、`['key']`、`[n]`、`[*]`;函数/过滤/递归/通配属性拒绝(沙箱)。
- 变量:`{keyword}` / `{source}`;`{source}` 相对路径自动基于 `baseURL` 补全。

## 核心接口

- `createAnimeClient({ rulesDir?, fetchImpl?, download? })` — 创建客户端
- `client.rules` — `list()` / `load(name)` / `validateJson(json)`
- `client.search(keyword, { rules? })` — 搜索(打全部规则或指定规则),结果带 `[规则名]` 前缀
- `client.getRoads(item)` — 查线路(`Road { name, data[], identifier[] }`)
- `client.getEpisodes(item, road)` — 线路 → 集数(`Episode { name, url }`)
- `client.download(episode, { outputDir, rule, adFilter?, onProgress? })` — 下载单集 mp4
- `client.traceSearch(ruleName, keyword)` / `client.traceChapters(ruleName, source)` — 规则调试(原始响应 + 匹配片段 + 诊断)
- `RuleEngine` / `RestrictedJsonPath` / `parseM3u8` / `filterAds` 等底层能力可直接使用

**下载流程**:播放页取流解析(静态递归:直出 m3u8 → `<video>`/`<source>` 标签 → iframe 递归跟踪,不执行 JS)→ m3u8 解析(master 自动选最高码率)→ discontinuity 分组广告过滤 → 并发分片下载 → 本地 m3u8 构建 → ffmpeg 合并 mp4(自动处理 AES-128 加密分片)。纯 JS 动态取流的站点无法静态解析,报 `STREAM_PARSE_FAILED` 并提示手动获取直链。

## CLI(`sc-kazumi`)

```text
sc-kazumi search <keyword> [--rule <name>]
sc-kazumi roads <src-url>
sc-kazumi episodes <src-url> --rule <name>
sc-kazumi download <url> --rule <name> [--output-dir <dir>] [--no-ad-filter]
sc-kazumi rules list|add <file>|remove <name>|validate <file>
sc-kazumi rules test <name> <keyword>
```

规则调试首选 `sc-kazumi rules test <name> <keyword>`——直接看匹配片段/诊断/原始响应预览。完整手册见 [`skills/kazumi-cli/SKILL.md`](../../skills/kazumi-cli/SKILL.md)。

## DSH 工具

`@sakurachiyo0v0/dsh-sdk-tools`(≥0.5.0)已集成 kazumi agent 工具,经 `ts-dev-kits` 预设按需暴露:

- `kazumi_search <keyword>` — 按关键词在已配置规则中搜索
- `kazumi_roads <src>` — 查线路(含集数列表)
- `kazumi_download <url> [--rule]` — 下载单集 mp4(规则名缺省时从 URL host 推断)

选中 `ts-dev-kits` 预设的会话才拥有这些工具;DSH 设置 →「SDK工具」页可开关。使用前需先配置番剧规则(见上文「规则目录」)。

## 错误码

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `RULE_NOT_FOUND` | 规则不存在/规则目录为空 | 请先 `sc-kazumi rules add` |
| `RULE_INVALID` | 规则 JSON/XPath/JSONPath 非法 | 用 `rules validate` 检查 |
| `NO_RESULT` | 搜索/线路无结果 | 换关键词或检查规则是否失效 |
| `NETWORK` | 网络失败 | 检查网络/站点可达性 |
| `CAPTCHA` | 站点要求验证码 | 需浏览器手动验证(SDK 只感知不规避) |
| `STREAM_PARSE_FAILED` | m3u8 解析失败/播放页无静态视频源 | 站点可能 JS 动态取流,检查规则或手动取直链 |
| `DOWNLOAD_FAILED` | 分片下载失败 | 重试或检查网络 |
| `MERGE_FAILED` | ffmpeg 合并失败 | 检查 ffmpeg 安装 |
| `UNKNOWN` | 其他 | 看日志 |

统一错误类型 `KazumiError`,消息脱敏。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/kazumi typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/kazumi test        # 单测(mock 站全链路 + 受限 JSONPath 沙箱 + 真实 ffmpeg 合并)
pnpm --filter @sakurachiyo0v0/kazumi build       # 构建 ESM + CJS + d.ts + CLI
pnpm verify:kazumi-package                        # pack 后从临时消费项目验证 ESM/CJS 导入 + CLI
```

## 合规边界

- SDK 是中立规则引擎,不内置任何站点规则;规则是用户自己的配置。
- 不做任何站点绕过/伪装;`CAPTCHA` 只感知不规避。
- 下载仅用于个人用途,请遵守目标站点条款与当地法律。
