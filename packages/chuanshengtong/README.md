# @sakurachiyo0v0/chuanshengtong

传声筒:输入文字 + 内置图像模板,程序化合成输出图片(不依赖 AI 图像生成 API)。CLI 与 SDK 双形态,中文自动换行/居中/超长保护。

**适用环境:** Node.js 20+;中文渲染依赖系统安装中文字体(如 Noto Sans CJK、文鼎 AR PL 系列),无中文字体时文字显示为方框。

## 安装方式

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/chuanshengtong@workspace:*
```

从私有 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 的 `allowBuilds` 中授权 `sharp: true`,否则 sharp 原生模块不会安装):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chuanshengtong"
```

```yaml
# pnpm-workspace.yaml
allowBuilds:
  sharp: true
```

## CLI 用法

```powershell
amechan-chuanshengtong list                          # 列出内置模板(JSON)
amechan-chuanshengtong render "要传的话"              # 默认大字报模板,输出 chuanshengtong-<时间戳>.png
amechan-chuanshengtong render "台词" --template speech-bubble --output bubble.png
amechan-chuanshengtong render "通知" --template notice --format jpeg --width 600 --quality 80
amechan-chuanshengtong render "愿你好" --template card --font-size 48 --color "#ffcc00"
```

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `--template <id>` | 模板 id(`list` 查看) | `dazibao` |
| `--output <path>` | 输出文件路径 | `chuanshengtong-<时间戳>.png` |
| `--format <png\|jpeg>` | 输出格式(与文件扩展名无关) | `png` |
| `--width <px>` | 输出宽度,高度按模板比例缩放 | 模板宽度 |
| `--font-size <px>` | 覆盖模板默认字号 | 模板默认 |
| `--color <css>` | 覆盖模板默认文字颜色(hex/颜色名/rgb) | 模板默认 |
| `--quality <1-100>` | jpeg 质量 | `90` |

## SDK API

```ts
import { listTemplates, getTemplate, render, wrapText } from "@sakurachiyo0v0/chuanshengtong";

// 列出模板
const templates = listTemplates(); // [{ id, name, description, width, height, maxTextLength }]

// 渲染一张图
const result = await render({
  template: "dazibao",
  text: "你好,世界",
  output: "./out.png",
  format: "png",        // 可选
  width: 1200,          // 可选,默认模板宽度
  fontSize: 64,         // 可选,覆盖模板默认字号
  color: "#1a1a1a",     // 可选,覆盖模板默认文字颜色
  quality: 90,          // 可选,jpeg 质量 1-100
});
// result: { outputPath, width, height, format, bytes }

// 排版纯函数(可复用)
const { lines, truncated } = wrapText("你好,世界", { fontSize: 64, maxWidth: 960, maxLines: 8 });
```

### 模板

| id | 名称 | 描述 | 容量 |
| --- | --- | --- | --- |
| `dazibao` | 大字报 | 红头白字标题 + 中部黑色大字正文 + 底部红条 | 120 字 / 8 行 |
| `speech-bubble` | 台词气泡 | 漫画风白底黑描边椭圆 + 尾巴,适合角色台词 | 60 字 / 5 行 |
| `card` | 卡片 | 深色渐变底 + 白色文字居中 + 圆角 | 90 字 / 6 行 |
| `notice` | 公告 | 米黄底双线边框 + 红字标题 + 红色印章 | 110 字 / 7 行 |

排版规则:中文(CJK)按字符断行,连续英文/数字按空白断词;行数超模板上限抛 `TEXT_TOO_LONG`(不静默丢字);输入中的 `\n` 强制分段。

## 错误码

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `TEMPLATE_NOT_FOUND` | 模板 id 不存在 | 用 `list` 查看可用模板 |
| `EMPTY_TEXT` | 文字为空 | 传入要传的话 |
| `TEXT_TOO_LONG` | 文字超出模板容量/排版行数 | 缩短文字或换模板 |
| `INVALID_OPTION` | 参数非法(负宽度/非法颜色/未知格式/质量越界) | 检查参数 |
| `RENDER_FAILED` | sharp 渲染失败 | 检查输出路径与系统字体 |
| `WRITE_FAILED` | 写文件失败 | 检查输出目录权限 |
| `UNKNOWN` | 未归类错误 | 反馈日志 |

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/chuanshengtong typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/chuanshengtong test        # 单测(排版/转义/注册表 + sharp 真实渲染)
pnpm --filter @sakurachiyo0v0/chuanshengtong build       # 构建 ESM + CJS + d.ts + CLI
```

## 设计文档

[`docs/superpowers/specs/2026-08-25-chuanshengtong-design.md`](../../docs/superpowers/specs/2026-08-25-chuanshengtong-design.md)
