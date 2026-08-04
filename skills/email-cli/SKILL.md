# amechan-email 邮件发送 CLI

让 AI 直接用 `amechan-email` 命令行发送邮件、验证 SMTP 连接。无需写代码。

## 环境检查

```bash
amechan-email help    # 查看命令
```

未安装:`npm i -g @amechan/email`。

## 命令速查

### 验证 SMTP 连接

```bash
amechan-email verify --host smtp.example.com --port 465 --secure --user mailer@example.com --password xxx
```

### 发送邮件

```bash
amechan-email send \
  --host smtp.example.com --port 587 \
  --user mailer@example.com --password xxx \
  --from "Ame <mailer@example.com>" \
  --to "user@example.com" \
  --subject "测试邮件" \
  --text "纯文本内容"
```

支持 `--html` 替代 `--text` 发送 HTML 邮件,`--to` 可逗号分隔多个收件人。

## 配置方式

命令行传参或环境变量:

```bash
export SMTP_HOST=smtp.example.com
export SMTP_PORT=465
export SMTP_SECURE=true
export SMTP_USER=mailer@example.com
export SMTP_PASSWORD=xxx
export SMTP_FROM="Ame <mailer@example.com>"

amechan-email send --to "user@example.com" --subject "Hi" --text "Hello"
```

## 端口与 secure 配对

| 端口 | secure | 说明 |
| --- | --- | --- |
| 465 | `--secure` | 连接即 TLS |
| 587 | 无 | STARTTLS(常用) |

## 任务配方

### 发 HTML 邮件

```bash
amechan-email send --host smtp.example.com --port 465 --secure --user u --password p \
  --from "noreply@example.com" --to "a@example.com,b@example.com" \
  --subject "周报" --html "<h1>本周摘要</h1><p>内容</p>"
```

### 先验证再发送

```bash
amechan-email verify --host smtp.example.com --port 465 --secure --user u --password p
amechan-email send --host smtp.example.com --port 465 --secure --user u --password p \
  --from "noreply@example.com" --to "a@example.com" --subject "Hi" --text "body"
```

## 陷阱清单

- **密码不要硬编码在脚本里**,用环境变量。
- **端口与 secure 配对错会连接失败**:465 加 `--secure`,587 不加。
- **`--text` 或 `--html` 至少一个**,否则报错。
- **多数邮箱服务商用"应用专用密码"/"授权码"**,不是登录密码。
- **send 成功输出 JSON**,含 messageId/accepted/rejected。

## 验证

- `verify` 成功:`{"ok":true,"message":"SMTP connection verified"}`。
- `send` 成功:输出 `{provider, messageId, accepted, rejected, response}`。
- 先发给自己测试,确认收到再发真实收件人。
