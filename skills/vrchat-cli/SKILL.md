# amechan-vrchat CLI

让 AI 直接用 `amechan-vrchat` 命令行操作 VRChat 官方 API:密码登录(支持 2FA)、会话状态、登出、以及 14 个 API 域的查询与写操作(用户/世界/头像/实例/好友/通知/收藏/群组/文件/权限/系统/经济/审核)。无需写代码。

## 命令域总览

| 域 | 顶层命令 | 覆盖 |
| --- | --- | --- |
| 认证/会话 | `login` / `status` / `logout` | 密码 + 2FA、会话检查、登出 |
| 用户 | `users` | get / profile / search / friend-status / worlds / groups / mutuals / avatar / active / update-status / update-bio |
| 世界 | `worlds` | get / search / favorites / recent / active / add-tags / remove-tags / publish |
| 头像 | `avatars` | get / search / owned / favorites / licensed / styles / select |
| 实例 | `instances` | get / short-name / recent |
| 好友 | `friends` | list / add / remove |
| 通知 | `notifications` | list / get / accept / hide / see / reply / clear |
| 收藏 | `favorites` | list / add / remove / groups / by-group |
| 群组 | `groups` | get / search / members / member / remove-member / add-role / remove-role / roles / role-templates / instances / permissions / requests / approve / bans / ban / unban / join / leave / announcement / announce |
| 文件 | `files` | get / list / create / create-image / delete |
| 权限 | `permissions` | list / get |
| 系统 | `system` | health(需登录) / stats / time(无需登录) |
| 经济 | `economy` | balance / transactions |
| 审核 | `moderation` | list / create / unmoderate / report |
| 邀请 | `invite` | invite / request / join / respond |
| 快捷消息 | `messages` | list / get / update |

## 环境检查

```bash
amechan-vrchat help    # 查看命令与选项
which amechan-vrchat   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/vrchat`。

## 登录

登录态自动从 `auth.json` 加载(默认 `<配置根>/amechan/vrchat/auth.json`),**无需手动传 cookie**:

```bash
amechan-vrchat login [username]        # 密码登录,交互式输入密码;开启 2FA 时按提示输入验证码
amechan-vrchat login alice --password 'xxx'   # 直接提供密码(不提示)
amechan-vrchat status                   # 查看登录状态(是否已登录、存储路径、保存时间)
amechan-vrchat logout                   # 登出(调用 API + 清除本地登录态)
```

- `--auth-path <path>` 可指定登录态文件路径(或环境变量 `AMECHAN_VRCHAT_AUTH_PATH`)。
- 测试/自定义网关可用环境变量 `AMECHAN_VRCHAT_BASE_URL` 覆盖 API 基地址。
- 登录凭证只保存 cookie,不保存密码。

## 命令速查

### 登录 / 会话

| 命令 | 说明 |
| --- | --- |
| `amechan-vrchat login [username]` | 密码登录(2FA:邮箱 OTP / TOTP),成功持久化登录态 |
| `amechan-vrchat status` | 显示登录态(是否登录、auth.json 路径、保存时间) |
| `amechan-vrchat logout` | 登出并删除本地登录态 |

### 用户(`users`)

```bash
amechan-vrchat users get <userId>              # 按 ID 获取用户
amechan-vrchat users profile <userId>          # 获取用户公开资料
amechan-vrchat users search <query>            # 搜索用户(--n --offset)
amechan-vrchat users friend-status <userId>    # 好友关系状态
amechan-vrchat users worlds <userId>           # 用户发布的世界
amechan-vrchat users groups <userId>           # 用户加入的群组
amechan-vrchat users mutuals <userId>          # 与用户的共同好友
amechan-vrchat users avatar <userId>           # 用户的当前头像
amechan-vrchat users active                    # 活跃用户列表(--n --offset)
amechan-vrchat users update-status <text>      # 更新自己的状态文本
amechan-vrchat users update-bio <text>         # 更新自己的个人简介
```

### 世界(`worlds`)

```bash
amechan-vrchat worlds get <worldId>            # 按 ID 获取世界
amechan-vrchat worlds search <query>           # 搜索世界(--n --offset --sort)
amechan-vrchat worlds favorites                # 收藏的世界(--n --offset)
amechan-vrchat worlds recent                   # 最近访问的世界(--n --offset)
amechan-vrchat worlds active                   # 活跃的世界(--n --offset)
amechan-vrchat worlds add-tags <worldId> <tag> # 给世界添加标签
amechan-vrchat worlds remove-tags <worldId> <tag>  # 移除世界标签
amechan-vrchat worlds publish <worldId>        # 发布世界(公开)
```

### 头像(`avatars`)

```bash
amechan-vrchat avatars get <avatarId>          # 按 ID 获取头像
amechan-vrchat avatars search <query>          # 搜索头像(--n --offset)
amechan-vrchat avatars owned <userId>          # 用户拥有的头像
amechan-vrchat avatars favorites               # 收藏的头像(--n --offset)
amechan-vrchat avatars licensed                # 授权头像(--n --offset)
amechan-vrchat avatars styles                  # 头像风格(无需登录)
amechan-vrchat avatars select <avatarId>       # 选择当前使用的头像
```

### 实例(`instances`)

```bash
amechan-vrchat instances get <worldId> <instanceId>   # 获取实例
amechan-vrchat instances short-name <worldId> <instanceId>  # 获取实例短码
amechan-vrchat instances recent                # 最近访问的实例(--n --offset)
```

### 好友(`friends`)

```bash
amechan-vrchat friends list                    # 好友列表(--n --offset)
amechan-vrchat friends add <userId>            # 发送好友请求
amechan-vrchat friends remove <userId>         # 删除好友
```

### 通知(`notifications`)

```bash
amechan-vrchat notifications list              # 通知列表(--type --n --offset)
amechan-vrchat notifications get <notificationId>  # 单条通知详情
amechan-vrchat notifications accept <notificationId>  # 接受通知(好友请求/邀请)
amechan-vrchat notifications hide <notificationId>    # 隐藏/拒绝通知
amechan-vrchat notifications see <notificationId>     # 标记已读
amechan-vrchat notifications reply <notificationId> <message>  # 回复通知
amechan-vrchat notifications clear             # 清除所有已读通知
```

### 收藏(`favorites`)

```bash
amechan-vrchat favorites list --type avatar    # 收藏列表(--type)
amechan-vrchat favorites add avatar <avatarId> # 添加收藏
amechan-vrchat favorites remove <favoriteId>   # 删除收藏
amechan-vrchat favorites groups avatar         # 收藏分组列表
amechan-vrchat favorites by-group avatar avatars_1 <userId>  # 按分组获取收藏
```

### 群组(`groups`)

```bash
amechan-vrchat groups get <groupId>            # 按 ID 获取群组
amechan-vrchat groups search <query>           # 搜索群组(--n --offset)
amechan-vrchat groups members <groupId>        # 群组成员列表(--n --offset)
amechan-vrchat groups member <groupId> <userId>  # 单个成员详情
amechan-vrchat groups remove-member <groupId> <userId>  # 移除成员
amechan-vrchat groups add-role <groupId> <userId> <roleId>  # 给成员分配角色
amechan-vrchat groups remove-role <groupId> <userId> <roleId>  # 移除成员角色
amechan-vrchat groups roles <groupId>          # 群组角色列表
amechan-vrchat groups role-templates           # 群组角色模板
amechan-vrchat groups instances <groupId>      # 群组实例列表
amechan-vrchat groups permissions <groupId>    # 群组权限列表
amechan-vrchat groups requests <groupId>       # 加入申请列表
amechan-vrchat groups approve <groupId> <userId>  # 批准加入申请
amechan-vrchat groups bans <groupId>           # 封禁列表
amechan-vrchat groups ban <groupId> <userId>   # 封禁用户
amechan-vrchat groups unban <groupId> <userId> # 解除封禁
amechan-vrchat groups join <groupId>           # 加入群组
amechan-vrchat groups leave <groupId>          # 离开群组
amechan-vrchat groups announcement <groupId>   # 查看群组公告
amechan-vrchat groups announce <groupId> <message>  # 发布群组公告
```

### 文件(`files`)

```bash
amechan-vrchat files get <fileId>              # 按 ID 获取文件
amechan-vrchat files list                      # 列出当前用户文件(--n --offset)
amechan-vrchat files create <name> <mimeType> <extension>  # 创建文件
amechan-vrchat files create-image <name> <mimeType> <extension>  # 创建图片文件
amechan-vrchat files delete <fileId>           # 删除文件
```

### 权限(`permissions`)

```bash
amechan-vrchat permissions list                # 全部权限位
amechan-vrchat permissions get <permissionId>  # 按 ID 获取权限位
```

### 系统(`system`)

```bash
amechan-vrchat system health                   # 健康检查(需登录)
amechan-vrchat system stats                    # 在线人数(无需登录,返回数字)
amechan-vrchat system time                     # 服务器时间(无需登录,返回 ISO 字符串)
```

### 经济(`economy`)

```bash
amechan-vrchat economy balance <userId>        # 用户余额
amechan-vrchat economy transactions <userId>   # 用户交易记录(--n --offset)
```

### 审核(`moderation`)

```bash
amechan-vrchat moderation list --type block    # 玩家管理列表(--type)
amechan-vrchat moderation create mute <userId> # 创建玩家管理(静音/封禁等)
amechan-vrchat moderation unmoderate mute <userId>  # 解除玩家管理
amechan-vrchat moderation report <reportedUserId>  # 举报用户
```

### 邀请(`invite`)

```bash
amechan-vrchat invite invite <userId> <worldId> <instanceId>  # 邀请用户到实例
amechan-vrchat invite request <userId>        # 请求加入对方所在实例
amechan-vrchat invite join <worldId> <instanceId>  # 自己加入实例
amechan-vrchat invite respond <notificationId> <yes|no>  # 响应邀请
```

### 快捷消息(`messages`)

```bash
amechan-vrchat messages list <userId> <type>   # 快捷消息列表(type: message/response/request/requestResponse)
amechan-vrchat messages get <userId> <type> <slot>  # 获取槽位快捷消息
amechan-vrchat messages update <userId> <type> <slot> <text>  # 更新槽位快捷消息
```

## 输出

默认输出 JSON(`--json` 为默认,无需显式传)。示例:

```json
{ "loggedIn": false, "message": "未登录,请运行 amechan-vrchat login" }
```

## 错误码

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `INVALID_CREDENTIALS` | 用户名或密码错误 | 检查凭据重试 |
| `TWO_FACTOR_REQUIRED` | 需要 2FA 但无法取码 | 交互式输入验证码 |
| `TWO_FACTOR_FAILED` | 验证码错误/超限 | 重新获取验证码 |
| `AUTH_EXPIRED` | 会话已失效(401) | 重新 login |
| `RATE_LIMIT` | 请求过于频繁(429) | 稍后再试 |
| `NOT_FOUND` | 资源不存在(404) | 检查 ID/链接 |
| `NETWORK` | 网络失败 | 检查网络 |
