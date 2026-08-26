# sc-log CLI

让 AI 直接用 `sc-log` 命令行查询日志(配合 `@sakurachiyo0v0/logger` + `DatabaseLogTransport` 使用)。支持**按等级/设备/时间/命名空间/关键词**过滤,查本地 SQLite 或服务器 PostgreSQL(跨机聚合)。**基于 `@sakurachiyo0v0/database` SDK**。

## 环境检查

```bash
sc-log help    # 查看命令与选项
which sc-log   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/database`。

## 日志存储架构

- **本地**:`DatabaseLogTransport` 写 `<配置根>/amechan/logs/<hostname>.db`(SQLite),永远可查。
- **远程**:同 transport 配置 `remoteUrl` 后批量同步到服务器 PostgreSQL(集中聚合,跨机可查)。
- **查询**:`sc-log` 默认查远程(`--remote-url`),查本地需显式 `--local-path`。

## 查询参数

| 参数 | 说明 |
|---|---|
| `--remote-url <url>` | 远程 PostgreSQL 连接串(如 `postgresql://user:pass@host:5432/db`) |
| `--local-path <path>` | 本地 SQLite 日志库路径(查本机日志用) |
| `--level <name>` | 等级过滤:`debug/info/warn/error`(可重复,如 `--level error --level warn`) |
| `--device <hostname>` | 设备过滤(hostname 精确匹配) |
| `--namespace <ns>` | 命名空间过滤(子串匹配,如 `bilibili`) |
| `--since <time>` | 起始时间:ISO(如 `2026-08-26T00:00:00Z`)或相对(`30m`/`1h`/`1d`) |
| `--until <iso>` | 结束时间(ISO) |
| `--keyword <kw>` | 关键词搜索(message/data 模糊匹配) |
| `--limit <n>` | 返回条数(默认 100) |
| `--offset <n>` | 跳过条数(分页) |

## 使用示例

```bash
# 查远程全部日志(最近 100 条)
sc-log --remote-url "postgresql://logs:***@amechan.cloud:42173/logs"

# 只查 ERROR 级别
sc-log --remote-url "$LOG_URL" --level error

# 查某台设备的日志
sc-log --remote-url "$LOG_URL" --device desktop-01

# 查最近 1 小时某个命名空间的 warn/error
sc-log --remote-url "$LOG_URL" --since 1h --namespace bilibili --level warn --level error

# 关键词搜索
sc-log --remote-url "$LOG_URL" --keyword "download"

# 查本机本地日志库
sc-log --local-path ~/.config/amechan/logs/$(hostname).db --level error
```

输出为 JSON 数组,每条含 `time/level/namespace/hostname/message/data`:

```json
[
  {
    "time": "2026-08-26T05:46:57.817Z",
    "level": "ERROR",
    "namespace": "cli-demo",
    "hostname": "desktop-01",
    "message": "CLI 测试:下载失败",
    "data": "{\"error\":{\"message\":\"mock failure\",\"stack\":\"...\"}}"
  }
]
```

## 注意事项

- **只传 `--remote-url` 不碰本地库**,只传 `--local-path` 只查本地;两者都传则合并去重。
- 连接串含密码时推荐用环境变量(`export LOG_URL="..."`),避免出现在进程列表/历史记录。
- 日志字段 `data` 为 JSON 字符串,error 对象序列化为 `{message, stack, code?}`。
- 服务器 PostgreSQL 表结构由 `DatabaseLogTransport` 自动建(首次写入时),无需手动建表。
