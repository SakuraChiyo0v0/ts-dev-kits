# amechan-chuanshengtong CLI

让 AI 直接用 `amechan-chuanshengtong` 命令行把文字套用内置图像模板生成图片(传声筒)。**基于 `@sakurachiyo0v0/chuanshengtong` SDK**。

## 环境检查

```bash
amechan-chuanshengtong help    # 查看命令与选项
which amechan-chuanshengtong   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/chuanshengtong`。

## 模板

```bash
amechan-chuanshengtong list    # 列出内置模板(id/名称/尺寸/容量)
```

模板 id 一览:

| id | 名称 | 说明 | 容量 |
| --- | --- | --- | --- |
| `dazibao` | 大字报 | 红头白字标题 + 中部黑色大字正文 + 底部红条 | 120 字 / 8 行 |
| `speech-bubble` | 台词气泡 | 漫画风白底黑描边椭圆 + 尾巴,适合角色台词 | 60 字 / 5 行 |
| `card` | 卡片 | 深色渐变底 + 白色文字居中 + 圆角 | 90 字 / 6 行 |
| `notice` | 公告 | 米黄底双线边框 + 红字标题 + 红色印章 | 110 字 / 7 行 |

## 命令速查

```bash
amechan-chuanshengtong help                                            # 显示帮助
amechan-chuanshengtong list                                            # 列出全部模板(JSON)
amechan-chuanshengtong render "要传的话"                                # 默认 dazibao 模板,输出 chuanshengtong-<时间戳>.png
amechan-chuanshengtong render "我会回来的!" --template speech-bubble --output bubble.png
amechan-chuanshengtong render "通知" --template notice --format jpeg --width 600 --quality 80
amechan-chuanshengtong render "愿你好" --template card --font-size 48 --color "#ffcc00"
```

### 选项

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `--template <id>` | 模板 id(list 查看) | `dazibao` |
| `--output <path>` | 输出文件路径 | `chuanshengtong-<时间戳>.png` |
| `--format <png\|jpeg>` | 输出格式(与文件扩展名无关) | `png` |
| `--width <px>` | 输出宽度,高度按模板比例缩放 | 模板宽度 |
| `--font-size <px>` | 覆盖模板默认字号 | 模板默认 |
| `--color <css>` | 覆盖模板默认文字颜色(hex/颜色名/rgb) | 模板默认 |
| `--quality <1-100>` | jpeg 质量 | `90` |

## 注意事项

- 文字超长:超过模板容量或排版行数 → `[TEXT_TOO_LONG]`,需缩短文字或换模板;用 `list` 查看各模板容量。
- 中文渲染依赖系统安装中文字体(如 Noto Sans CJK / 文鼎),无中文字体时文字会显示为方框。
- 输出目录必须存在,否则 `[WRITE_FAILED]`。
- 全部命令输出 JSON。
