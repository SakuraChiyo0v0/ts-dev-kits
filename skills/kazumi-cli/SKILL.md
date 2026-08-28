# sc-kazumi CLI

让 AI 直接用 `sc-kazumi` 命令行操作番剧采集下载 SDK(`@sakurachiyo0v0/kazumi`):**声明式规则引擎(XPath/API 双模式)+ m3u8 下载合并成 mp4**。规则兼容 Kazumi/KazumiRules 生态的 JSON 格式;SDK 本身**不内置任何站点规则**,规则由用户导入到自己的规则目录。

## 环境检查

```bash
sc-kazumi help    # 查看命令与选项
which sc-kazumi   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/kazumi`。下载合并 mp4 需要系统安装 `ffmpeg`。

## 规则目录与配置

- 规则目录默认 `<配置根>/amechan/kazumi/rules/`(Windows `%APPDATA%`,macOS `~/Library/Application Support`,Linux `$XDG_CONFIG_HOME` 或 `~/.config`;可用 `AMECHAN_CONFIG_HOME` 覆盖配置根)。
- 环境变量 `AMECHAN_KAZUMI_RULES_DIR` 可覆盖规则目录(测试/多目录场景)。
- 每个规则一个 `<规则名>.json` 文件,文件名即规则名。
- **规则来源**:从 [KazumiRules](https://github.com/Predidit/KazumiRules) 仓库下载对应 `<name>.json` 后用 `sc-kazumi rules add` 导入;或手写。SDK 不内置规则。

### WebDAV 多端同步(可选)

`AMECHAN_KAZUMI_SYNC=1` 开启规则 WebDAV 同步(经 `@sakurachiyo0v0/config` namespace("kazumi"),加密存云端 `/amechan/secrets/kazumi/`;前置:先 `sc-config setup` 配置 WebDAV):

- `rules add` / `rules remove` 本地 + WebDAV 双写,换机器自动拉取;
- 搜索/`rules load` 前先同步远端规则到本地缓存;
- 无全局配置或网络失败时自动回退本地,不报错。

### 规则 JSON 格式(兼容 Kazumi)

XPath 模式(抓 HTML 页面):

```json
{
  "api": "1",
  "name": "站点名",
  "baseURL": "https://example.com",
  "searchURL": "https://example.com/search?kw=@keyword",
  "searchList": "//div[2]/div/section/div/div/div/div",
  "searchName": "//div/div[2]/h5/a",
  "searchResult": "//div/div[2]/h5/a",
  "chapterRoads": "//div[2]/div/section/div/div[2]/div[2]/div[2]/div",
  "chapterResult": "//ul/li/a"
}
```

- `searchList` / `chapterRoads` 是**绝对 XPath**;`searchName` / `searchResult` / `chapterResult` 是**相对列表项的 XPath**(`//x` 在节点上等价 `.//x`)。
- `searchURL` 里 `@keyword` 占位符会被替换为编码后的关键词。
- 可选字段:`userAgent`、`referer`、`muliSources`、`searchMode`/`chapterMode`(`"api"` 启用 API 模式)、`antiCrawlerConfig`(仅 `enabled`/`captchaDetectValue`,验证码检测文本)。

API 模式(请求模板 + JSONPath):

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
    "format": "nested",
    "roadsPath": "$.data.roads[*]",
    "roadNamePath": "$.name",
    "episodesPath": "$.episodes[*]",
    "episodeNamePath": "$.name",
    "episodeUrlPath": "$.url"
  }
}
```

- JSONPath 仅支持受限安全子集:`$`、`.key`、`['key']`、`[n]`、`[*]`。**函数调用/过滤/递归/通配属性一律拒绝**(沙箱)。
- 变量:`{keyword}`(搜索)、`{source}`(章节);模板里 `{source}` 传相对路径时自动基于 `baseURL` 补全。

## 命令速查

### 搜索与浏览

```bash
sc-kazumi search <keyword> [--rule <name>]  # 按关键词搜索(默认打全部规则;--rule 只打单规则)
sc-kazumi roads <src-url>                   # 查询线路列表(结果 src 字段给详情页 URL)
sc-kazumi episodes <src-url> --rule <name>  # 查询集数列表(必须指定规则)
sc-kazumi download <url> --rule <name> [--output-dir <dir>] [--no-ad-filter]
```

- 搜索结果带 `[规则名]` 前缀标识来源;`src` 是详情页 URL,供 `roads` 使用。
- `roads` 输出线路(`name` + `data`[集数 URL 数组] + `identifier`[集数名数组])。
- `download` 默认启用 discontinuity 广告过滤(剔除短广告分组);`--no-ad-filter` 关闭。下载流程:**播放页取流解析**(静态递归:直出 m3u8 → video/source 标签 → iframe 跟踪,不执行 JS)→ 解析 m3u8(master 自动选最高码率)→ 并发下载分片 → ffmpeg 合并成 mp4(自动处理 AES-128 加密)。纯 JS 动态取流站点报 `STREAM_PARSE_FAILED`,需手动用浏览器取 m3u8 直链。
- 输出文件:`<output-dir>/<集数名>.mp4`。

### 规则管理

```bash
sc-kazumi rules list                          # 列出已配置规则
sc-kazumi rules add <file.json>               # 导入规则(校验通过后写入规则目录)
sc-kazumi rules remove <name>                 # 删除规则
sc-kazumi rules validate <file.json>          # 校验规则 JSON 合法性(不导入)
sc-kazumi rules test <name> <keyword>         # 本地试规则:输出匹配片段/诊断/原始响应预览
```

- `rules add` / `validate` 会做规则校验(XPath 字段齐全、JSONPath 表达式合法),校验失败拒绝导入。
- `rules test` 是调规则的首选:直接看 `count`/`items`/`diagnostics`(跳过节点原因)/`rawResponsePreview`,快速判断规则是否失效或选择器写错。

## 典型流程

```bash
# 1. 导入 KazumiRules 的规则
sc-kazumi rules add ~/下载/AGE.json

# 2. 搜索
sc-kazumi search "药屋少女的呢喃"

# 3. 查线路 → 集数
sc-kazumi roads "https://example.com/detail/101"
sc-kazumi episodes "https://example.com/detail/101" --rule AGE

# 4. 下载某集
sc-kazumi download "https://example.com/play/xxx.m3u8" --rule AGE --output-dir ~/Downloads/番剧
```

## 错误码

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `RULE_NOT_FOUND` | 规则不存在/规则目录为空 | `sc-kazumi rules add` 导入规则 |
| `RULE_INVALID` | 规则 JSON/XPath/JSONPath 非法 | `sc-kazumi rules validate` 检查 |
| `NO_RESULT` | 搜索/线路无结果 | 换关键词;规则可能失效 |
| `NETWORK` | 网络失败 | 检查网络/站点可达性 |
| `CAPTCHA` | 站点要求验证码 | SDK 只感知不规避,需手动浏览器验证 |
| `STREAM_PARSE_FAILED` | m3u8 解析失败/播放页无静态视频源 | 站点 JS 动态取流,检查规则或手动取直链 |
| `DOWNLOAD_FAILED` | 分片下载失败 | 重试 |
| `MERGE_FAILED` | ffmpeg 合并失败 | 检查 ffmpeg 安装 |

## 合规边界

- SDK 是**中立规则引擎**,不内置任何站点规则;规则是用户自己的配置(从 KazumiRules 等社区导入)。
- 不做任何站点绕过/伪装;`CAPTCHA` 只感知不规避。
- 下载仅用于个人用途,请遵守目标站点条款与当地法律。
