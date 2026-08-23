# CLI Skill 同步保障机制设计(校验脚本 + 手动维护)

日期:2026-08-23
状态:已批准(用户选择"版本守卫式校验脚本"方案,并否定了契约版本号思路,采用自动扫描对比)

## 背景

`skills/` 目录下的 CLI skill(`bilibili-cli` / `email-cli` / `ffmpeg-cli`)是给 AI 用的命令行操作手册。
审计发现:

| skill | 状态 |
| --- | --- |
| `bilibili-cli` | ❌ **严重过时**:登录方式(旧 `--cookie` vs 新扫码 `login`)、编码对照表写反(`codecId 7=AV1, 12=H264, 13=HEVC` 实际,skill 写成 AVC=7/HEVC=12/AV1=13)、缺失新增的 `fav/relation/tag` 平台控制命令 |
| `email-cli` | ✅ 准确(send/verify 与 CLI 一致) |
| `ffmpeg-cli` | ✅ 准确(17 个命令全部对上) |

根因:CLI 演进(新增命令、改登录方式)时没有强制同步 skill 的机制,靠人工自觉。

## 目标

1. **本次**:把 `bilibili-cli` 更新到与当前 CLI 完全一致(命令、登录、编码表、平台控制子命令)。
2. **机制**:让 skill 不再"静默过期"——CLI 变了,skill 没跟上,能被自动发现。

## 方案:两层混合校验(pre-commit 自动)

用户选定"版本守卫式校验脚本",并否决"契约版本号"思路(需要人工维护版本号,不想要)。最终采用**自动扫描对比 + 修改时间兜底**两层:

### 第 1 层:命令集对比(自动、100% 准确)

**事实来源**:各 CLI 源码中的结构化常量 `COMMANDS` 数组,例如:

```ts
// packages/bilibili/src/cli/bilibili.ts
const COMMANDS = [
  { name: "login", desc: "..." },
  { name: "fav", desc: "..." },
  // ...
];
```

**校验方法**:
- 解析 `packages/*/src/cli/*.ts`,用正则提取 `COMMANDS = [ ... { name: "<cmd>" } ... ]` 数组(以及 bilibili 的子命令数组 `FAV_COMMANDS` / `RELATION_COMMANDS` / `TAG_COMMANDS`;父命令 = 数组变量名前缀小写)
- 从对应 `skills/*/SKILL.md` 中提取 `amechan-<bin> <cmd>` 调用(行首或反引号后均可,子命令取 `bin parent sub` 二元组)
- 对比:
  - CLI 有而 skill 没有 → 报错"skill 缺命令 `<cmd>`"
  - skill 有而 CLI 没有 → 报错"skill 有过时命令 `<cmd>`"
  - 子命令同理,仅在 skill 已写该父命令的子命令时检查
- **不一致 → 阻止提交(exit 1)**

**准确率**:命令/子命令名层面 100%。CLI 的 COMMANDS 是结构化事实,skill 的命令调用是反引号模式,两边提取都无歧义。

### 第 2 层:修改时间兜底(粗粒度警告,不阻止)

**动机**:命令名没变但**参数/语义/文档表变化**时(如登录从 `--cookie` 改为自动加载、编码对照表写反),第 1 层扫描不到。这类是 bilibili-cli 过时的真正主因。

**校验方法**:
- 对每个 skill,找它对应的 CLI 源码文件(`packages/*/src/cli/*.ts`)
- 若 CLI 文件 mtime > SKILL.md mtime,输出 **警告**(不 exit 1),提醒"CLI 已修改但 skill 未同步,请人工检查参数/语义/文档表是否过期"

**准确率**:有意粗粒度。时间戳不可靠(换行也会触发),所以只警告不阻止,作为人工检查的提示器。

### 接线

- 新增脚本 `scripts/check-skill-staleness.mjs`
- 挂到 `.githooks/pre-commit`(与已有 `check-package-bumps.mjs` 并列)
- 已接入 `pnpm check`(末尾追加 `node scripts/check-skill-staleness.mjs`)

### 失败模式

- 脚本解析出错(COMMANDS 正则没匹配到)→ 打印错误但**不阻止提交**(避免误伤,宁可漏检)
- skill 文件不存在 → 跳过该 skill
- 无对应 CLI 的 skill → 跳过

## 本次同步更新内容(bilibili-cli)

重写 `skills/bilibili-cli/SKILL.md`:
- 登录:`login`(扫码,自动开浏览器)/ `logout` / `status`;登录态存 `auth.json` 自动加载;删掉旧的 `--cookie`/`BILI_COOKIE` 方式(如保留需注明仅调试用)
- 命令:补 `fav`(list/collected/info/videos/create/edit/delete/add/remove)、`relation`(follow/unfollow/block/unblock/followings/followers/stat/blacks)、`tag`(list/users/create/rename/delete/add/remove)
- 编码对照表:修正为 `codecId 7=AV1, 12=H264/AVC, 13=HEVC`
- 清晰度:64=720P, 80=1080P, 112=1080P高码率, 120=4K
- 高画质说明:未登录 720P,登录解锁 1080P+,4K 需大会员
- email-cli / ffmpeg-cli:校验通过即不改内容(本次审计已确认准确)

## 验证

- 运行 `node scripts/check-skill-staleness.mjs` → exit 0(三 skill 全部与 CLI 一致)
- 故意在 SKILL.md 删一个命令 → 脚本 exit 1 报"缺命令"
- 故意在 CLI 加一个假命令 → 脚本 exit 1 报"过时命令"
- pre-commit hook 在提交时自动运行

## 验收标准

- [ ] bilibili-cli 内容与当前 CLI 完全一致(命令、登录、编码表)
- [ ] `check-skill-staleness.mjs` 对三 skill 全部通过
- [ ] 第 1 层失败场景(缺命令/过时命令)能正确报错并阻止提交
- [ ] 第 2 层(时间戳)能输出警告
- [ ] pre-commit 已挂载,提交时自动运行
