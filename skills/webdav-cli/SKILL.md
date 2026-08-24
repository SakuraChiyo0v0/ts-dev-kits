# amechan-webdav CLI

让 AI 直接用 `amechan-webdav` 命令行操作 WebDAV 服务(坚果云/Nextcloud 等):文件读写、目录管理、配置文件存取。**基于 `@sakurachiyo0v0/webdav` SDK**。

## 环境检查

```bash
amechan-webdav help    # 查看命令与选项
which amechan-webdav   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/webdav`。

## 连接配置

连接参数支持命令行或环境变量(环境变量优先避免密码出现在进程列表):

```bash
export WEBDAV_URL="https://dav.example.com/dav/"
export WEBDAV_USERNAME="user"
export WEBDAV_PASSWORD="password"
```

或在每个命令后传 `--url <url> --username <user> --password <pass>`。

## 命令速查

### 基础文件操作

```bash
amechan-webdav ping                     # 连通性检查
amechan-webdav list <path>              # 列目录(默认 /)
amechan-webdav get <path>               # 读文件内容(默认 JSON 包裹;--raw 原样输出)
amechan-webdav put <path> --data "文本"  # 写文件(直接给内容)
amechan-webdav put <path> --file ./a.json # 写文件(从本地文件读)
amechan-webdav delete <path>            # 删文件/空目录
amechan-webdav mkdir <path>             # 建目录
amechan-webdav rmdir <path>             # 删目录
amechan-webdav move <src> <dst>         # 移动/重命名
```

### 配置文件存取(高层 API,原子写+自动备份)

```bash
amechan-webdav config-load <name> --base-path /configs    # 读取配置(JSON 自动解析)
amechan-webdav config-save <name> --json '{"a":1}'        # 保存配置(直接给 JSON)
amechan-webdav config-save <name> --file ./local.json     # 保存配置(从本地文件)
amechan-webdav config-load <name> --base-path /dir --backup-count 5  # 自定义目录/备份数
```

- `config-save` 原子写(临时文件+move 覆盖),旧版本自动滚动备份为 `<name>.bak.1/.bak.2/...`(默认保留 3 份,`--backup-count 0` 关闭)。
- 配置名不允许路径分隔符/`..`(防越界)。

## 错误码

- `AUTHENTICATION`:认证失败(401/403)——检查 `WEBDAV_USERNAME`/`WEBDAV_PASSWORD`。
- `CONNECTION`:网络/连接失败、超时——检查 URL 与网络。
- `NOT_FOUND`:文件/目录不存在(404)。
- `CONFLICT`:冲突(409/412),如不覆盖写已存在文件。
- `VALIDATION`:参数非法(空 URL、非法路径/配置名)。
- `UNKNOWN`:其他错误。

CLI 报错统一带错误码,如 `Error: [AUTHENTICATION] ping 失败: ...`。
