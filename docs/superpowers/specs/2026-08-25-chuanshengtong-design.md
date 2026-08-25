# 传声筒（chuanshengtong）SDK 设计

状态:用户已批准
日期:2026-08-25

## 1. 当前问题与目标

- 现状:想把「输入一段文字 → 套用图像模板 → 生成一张承载这句话的图片」的玩法做成工具。仓库里没有图片合成类 SDK。
- 目标:新增 `@sakurachiyo0v0/chuanshengtong` 包(CLI + SDK),输入文字 + 内置模板 id,程序化合成输出 PNG/JPEG。第一版为**模板合成**路线(不依赖 AI、不调用图像生成 API),模板为**内置模板库**。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 想做传声筒但没有工具 | `amechan-chuanshengtong render "要传的话" --template dazibao` 直接出图 |
| 无内置模板 | `amechan-chuanshengtong list` 列出内置模板库,文字自动按模板排版 |
| 无统一错误 | 统一 `ChuanshengtongError` + 错误码,消息可读 |

## 3. 方案选择

### 方案 A:node-canvas(不采用)

- 优点:文本排版能力直接(textMetrics 精确测宽)。
- 缺点:原生编译依赖 cairo/pango,安装重、跨平台(尤其 Windows)坑多;与仓库轻量构建链不符。

### 方案 B:纯 SVG 输出(不采用)

- 优点:零依赖、实现最简单。
- 缺点:产物是矢量 SVG 而非位图,与「生成图片」的预期不符(多数场景要 PNG/JPG)。
- 注:SVG 文本层本身是核心资产,sharp 方案复用它,只多一步 rasterize。

### 方案 C:sharp + SVG 文本层(采用)

- 优点:sharp 是 Node 生态图像处理事实标准,平台二进制 prebuilt(optionalDependencies 分发,如 `@img/sharp-linux-x64`),安装即用;SVG → 位图 + 多层合成能力强;文字经 libvips/Pango 渲染,跨平台一致。排版(换行/居中/截断)由我们控制。
- 缺点:引入原生依赖,需在 `pnpm-workspace.yaml` 的 `allowBuilds` 声明 `sharp: true`;渲染中文依赖系统装好中文字体(文档注明)。

### 方案 D:复用 `@sakurachiyo0v0/ffmpeg` 的 drawtext(不采用)

- 优点:零新依赖。
- 缺点:ffmpeg drawtext 自动换行/居中需手算像素,排版能力弱,不适合文本卡片类模板。

## 4. 仓库结构

```text
packages/chuanshengtong/
├─ src/
│  ├─ index.ts           公共出口:listTemplates / getTemplate / render / wrapText / 错误类
│  ├─ types.ts           模板与渲染类型、模板注册表(内置模板库的权威定义)
│  ├─ errors.ts          统一错误类 + 错误码
│  ├─ wrap.ts            换行排版纯函数(CJK 按字符、拉丁按词,超长截断加省略号)
│  ├─ svg.ts             XML 转义 + 文本区 SVG 文本层生成
│  ├─ templates/         内置模板实现(每个模板 = SVG 骨架 + 文本区配置)
│  └─ cli/chuanshengtong.ts  CLI 入口
├─ tests/                Vitest 单测(wrap/转义/注册表) + 集成测试(sharp 真实渲染)
├─ scripts/clean.mjs     构建清理(照抄 webdav)
├─ package.json          @sakurachiyo0v0/chuanshengtong,bin: amechan-chuanshengtong
├─ tsconfig.json / tsconfig.base.json / tsconfig.bundle.json / tsconfig.build.json / tsconfig.cli.json
├─ rollup.config.mjs     ESM + CJS 双格式,external: sharp / @sakurachiyo0v0/cli-utils / node:*
└─ README.md             安装方式 / CLI / API / 参数表 / 错误码 / 字体要求
```

## 5. 接口设计

### 类型与枚举(types.ts 为权威)

```ts
export type TemplateId = "dazibao" | "speech-bubble" | "card" | "notice";
export type OutputFormat = "png" | "jpeg";

export interface TemplateInfo {
  id: TemplateId;        // 模板 id
  name: string;          // 中文名
  description: string;   // 一句话说明
  width: number;         // 模板固有宽度(px)
  height: number;        // 模板固有高度(px)
  maxTextLength: number; // 该模板单次可容纳的最大字数(超出抛 TEXT_TOO_LONG)
}

export interface TextRegion {
  x: number; y: number; width: number; height: number; // 文本区(px,模板坐标系)
  align: "center" | "left";   // 水平对齐
  lineHeight: number;         // 行高(px)
  defaultFontSize: number;    // 默认字号(px)
  maxLines: number;           // 最大行数
  defaultColor: string;       // 默认文字颜色(CSS 颜色)
}

export interface RenderOptions {
  template: string;      // 模板 id(listTemplates 返回)
  text: string;          // 要传的文字,非空,长度 ≤ maxTextLength
  output: string;        // 输出文件路径(.png/.jpg 由 format 决定,与扩展名无关)
  format?: OutputFormat; // 默认 "png"
  width?: number;        // 输出宽度(px),默认模板宽度;高度按模板比例缩放
  fontSize?: number;     // 覆盖模板默认字号(px)
  color?: string;        // 覆盖模板默认文字颜色(CSS 颜色)
  quality?: number;      // jpeg 质量 1-100,默认 90
}

export interface RenderResult {
  outputPath: string;
  width: number; height: number;
  format: OutputFormat;
  bytes: number;
}
```

### API 形状

```ts
export function listTemplates(): TemplateInfo[];
export function getTemplate(id: string): TemplateInfo;              // 未知 id 抛 TEMPLATE_NOT_FOUND
export async function render(options: RenderOptions): Promise<RenderResult>;
export function wrapText(text: string, options: { fontSize: number; maxWidth: number; maxLines: number }): string[]; // 排版纯函数,可复用可测
export { ChuanshengtongError, ChuanshengtongErrorCode } from "./errors.js";
```

### 内置模板库(第一版 4 个,全部程序化 SVG 生成,无外部图片资源)

| id | 名称 | 描述 |
| --- | --- | --- |
| `dazibao` | 大字报 | 白底,顶部红底白字标题「传声筒」,中部大号黑字正文,底部红条 |
| `speech-bubble` | 台词气泡 | 漫画风白色椭圆气泡 + 黑描边 + 尾巴,文字居中 |
| `card` | 卡片 | 深色渐变底,白色文字居中,圆角 |
| `notice` | 公告 | 米黄底 + 双线边框 + 红色「传」印章,标题 + 正文 |

排版规则:中文按字符断行,连续英文/数字按空白断词;行数超 `maxLines` 截断并加省略号「…」;单字符宽度近似(CJK = fontSize,拉丁 = fontSize × 0.55),文本区预留 padding 容错。

## 6. 错误处理

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `TEMPLATE_NOT_FOUND` | 模板 id 不存在 | 用 `list` 查看可用模板 |
| `EMPTY_TEXT` | 文字为空 | 传入要传的话 |
| `TEXT_TOO_LONG` | 文字超出模板容量 | 缩短文字或换模板 |
| `INVALID_OPTION` | 参数非法(负宽度/非法颜色/未知格式/质量越界) | 检查参数 |
| `RENDER_FAILED` | sharp 渲染失败 | 检查输出路径与系统字体 |
| `WRITE_FAILED` | 写文件失败 | 检查输出目录权限 |
| `UNKNOWN` | 未归类错误 | 反馈日志 |

消息统一脱敏(本包不涉及凭据,保持风格一致)。

## 7. 测试策略

- 纯函数单测:wrapText(中文/英文/混合/超长截断/空)、XML 转义、模板注册表(list/get/未知 id)。
- 集成测试(真实路径):sharp 真实渲染 PNG/JPEG 到临时目录,校验文件存在、magic bytes、`sharp(input).metadata()` 宽高;错误分支覆盖(空文字/未知模板/坏输出路径/超长文字)。
- 写操作自清理:测试输出落在 `os.tmpdir()` 临时目录,测试结束清理。

## 8. CLI 与 skill 同步

```
amechan-chuanshengtong <command> [options]

commands:
  help                显示帮助
  list                列出内置模板(id/名称/尺寸/容量)
  render <text>       用模板生成图片(--template 默认 dazibao;--output 默认 chuanshengtong-<ts>.png)

options:
  --template <id>     模板 id(默认 dazibao)
  --output <path>     输出路径
  --format <png|jpeg> 输出格式(默认 png)
  --width <px>        输出宽度(默认模板宽度)
  --font-size <px>    覆盖字号
  --color <css>       覆盖文字颜色
  --quality <1-100>   jpeg 质量(默认 90)
```

新建 `skills/chuanshengtong-cli/SKILL.md` 与 CLI 命令集保持一致(pre-commit 守卫会校验)。

## 9. 版本与发布

- 新包 version `0.1.0`;根 `package.json` 的 `build` 脚本在 `cli-utils` 之后追加 `pnpm --filter @sakurachiyo0v0/chuanshengtong build`。
- `pnpm-workspace.yaml` 的 `allowBuilds` 追加 `sharp: true`。
- 更新 `docs/packages-index.md` 总览表 + 详情。
- 是否触发 CI 发布由用户拍板;发布后跑 `pnpm verify:published @sakurachiyo0v0/chuanshengtong`。

## 10. 验收条件

- [ ] `amechan-chuanshengtong list` 列出 4 个模板;`render "你好,世界" --template dazibao` 生成可用 PNG/JPEG
- [ ] 测试全绿(纯函数 + sharp 真实渲染 + 错误分支)
- [ ] README + packages-index 更新;`skills/chuanshengtong-cli/SKILL.md` 同步
- [ ] 版本已 bump;`pnpm check` 全仓通过
- [ ] 用户确认后提交推送
