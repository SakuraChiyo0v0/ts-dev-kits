# sc-vrchat CLI

让 AI 直接用 `sc-vrchat` 命令行操作 VRChat 官方 API:密码登录(支持 2FA)、会话状态、登出、以及 14 个 API 域的查询与写操作(用户/世界/头像/实例/好友/通知/收藏/群组/文件/权限/系统/经济/审核)。无需写代码。

## 命令域总览

| 域 | 顶层命令 | 覆盖 |
| --- | --- | --- |
| 认证/会话 | `login` / `status` / `logout` | 密码 + 2FA、会话检查、登出 |
| 用户 | `users` | get / profile / search / friend-status / worlds / groups / mutuals / avatar / active / update-status / update-bio |
| 世界 | `worlds` | get / search / favorites / recent / active / add-tags / remove-tags / publish |
| 头像 | `avatars` | get / search / owned / favorites / licensed / styles / select |
| 实例 | `instances` | get / short-name / recent |
| 好友 | `friends` | list / online / add / remove |
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
sc-vrchat help    # 查看命令与选项
which sc-vrchat   # 确认已安装
```

未安装:`npm i -g @sakurachiyo0v0/vrchat`。

## 登录

登录态自动从 `auth.json` 加载(默认 `<配置根>/amechan/vrchat/auth.json`),**无需手动传 cookie**:

```bash
sc-vrchat login [username]        # 密码登录,交互式输入密码;开启 2FA 时按提示输入验证码
sc-vrchat login alice --password 'xxx'   # 直接提供密码(不提示)
sc-vrchat status                   # 查看登录状态(是否已登录、存储路径、保存时间)
sc-vrchat logout                   # 登出(调用 API + 清除本地登录态)
```

- `--auth-path <path>` 可指定登录态文件路径(或环境变量 `AMECHAN_VRCHAT_AUTH_PATH`)。
- 测试/自定义网关可用环境变量 `AMECHAN_VRCHAT_BASE_URL` 覆盖 API 基地址。
- 登录凭证只保存 cookie,不保存密码。

## 命令速查

### 登录 / 会话

| 命令 | 说明 |
| --- | --- |
| `sc-vrchat login [username]` | 密码登录(2FA:邮箱 OTP / TOTP),成功持久化登录态 |
| `sc-vrchat status` | 显示登录态(是否登录、auth.json 路径、保存时间) |
| `sc-vrchat logout` | 登出并删除本地登录态 |

### 用户(`users`)

```bash
sc-vrchat users get <userId>              # 按 ID 获取用户
sc-vrchat users profile <userId>          # 获取用户公开资料
sc-vrchat users search <query>            # 搜索用户(--n --offset)
sc-vrchat users friend-status <userId>    # 好友关系状态
sc-vrchat users worlds <userId>           # 用户发布的世界
sc-vrchat users groups <userId>           # 用户加入的群组
sc-vrchat users mutuals <userId>          # 与用户的共同好友
sc-vrchat users avatar <userId>           # 用户的当前头像
sc-vrchat users active                    # 活跃用户列表(--n --offset)
sc-vrchat users update-status <text>      # 更新自己的状态文本
sc-vrchat users update-bio <text>         # 更新自己的个人简介
```

### 世界(`worlds`)

```bash
sc-vrchat worlds get <worldId>            # 按 ID 获取世界
sc-vrchat worlds search <query>           # 搜索世界(--n --offset --sort)
sc-vrchat worlds favorites                # 收藏的世界(--n --offset)
sc-vrchat worlds recent                   # 最近访问的世界(--n --offset)
sc-vrchat worlds active                   # 活跃的世界(--n --offset)
sc-vrchat worlds add-tags <worldId> <tag> # 给世界添加标签
sc-vrchat worlds remove-tags <worldId> <tag>  # 移除世界标签
sc-vrchat worlds publish <worldId>        # 发布世界(公开)
```

### 头像(`avatars`)

```bash
sc-vrchat avatars get <avatarId>          # 按 ID 获取头像
sc-vrchat avatars search <query>          # 搜索头像(--n --offset)
sc-vrchat avatars owned <userId>          # 用户拥有的头像
sc-vrchat avatars favorites               # 收藏的头像(--n --offset)
sc-vrchat avatars licensed                # 授权头像(--n --offset)
sc-vrchat avatars styles                  # 头像风格(无需登录)
sc-vrchat avatars select <avatarId>       # 选择当前使用的头像
```

### 实例(`instances`)

```bash
sc-vrchat instances get <worldId> <instanceId>   # 获取实例
sc-vrchat instances short-name <worldId> <instanceId>  # 获取实例短码
sc-vrchat instances recent                # 最近访问的实例(--n --offset)
```

### 好友(`friends`)

```bash
sc-vrchat friends list                    # 好友列表(--n --offset)
sc-vrchat friends online                  # 在线好友(含所在世界名)
sc-vrchat friends add <userId>            # 发送好友请求
sc-vrchat friends remove <userId>         # 删除好友
```

### 通知(`notifications`)

```bash
sc-vrchat notifications list              # 通知列表(--type --n --offset)
sc-vrchat notifications get <notificationId>  # 单条通知详情
sc-vrchat notifications accept <notificationId>  # 接受通知(好友请求/邀请)
sc-vrchat notifications hide <notificationId>    # 隐藏/拒绝通知
sc-vrchat notifications see <notificationId>     # 标记已读
sc-vrchat notifications reply <notificationId> <message>  # 回复通知
sc-vrchat notifications clear             # 清除所有已读通知
```

### 收藏(`favorites`)

```bash
sc-vrchat favorites list --type avatar    # 收藏列表(--type)
sc-vrchat favorites add avatar <avatarId> # 添加收藏
sc-vrchat favorites remove <favoriteId>   # 删除收藏
sc-vrchat favorites groups avatar         # 收藏分组列表
sc-vrchat favorites by-group avatar avatars_1 <userId>  # 按分组获取收藏
```

### 群组(`groups`)

```bash
sc-vrchat groups get <groupId>            # 按 ID 获取群组
sc-vrchat groups search <query>           # 搜索群组(--n --offset)
sc-vrchat groups members <groupId>        # 群组成员列表(--n --offset)
sc-vrchat groups member <groupId> <userId>  # 单个成员详情
sc-vrchat groups remove-member <groupId> <userId>  # 移除成员
sc-vrchat groups add-role <groupId> <userId> <roleId>  # 给成员分配角色
sc-vrchat groups remove-role <groupId> <userId> <roleId>  # 移除成员角色
sc-vrchat groups roles <groupId>          # 群组角色列表
sc-vrchat groups role-templates           # 群组角色模板
sc-vrchat groups instances <groupId>      # 群组实例列表
sc-vrchat groups permissions <groupId>    # 群组权限列表
sc-vrchat groups requests <groupId>       # 加入申请列表
sc-vrchat groups approve <groupId> <userId>  # 批准加入申请
sc-vrchat groups bans <groupId>           # 封禁列表
sc-vrchat groups ban <groupId> <userId>   # 封禁用户
sc-vrchat groups unban <groupId> <userId> # 解除封禁
sc-vrchat groups join <groupId>           # 加入群组
sc-vrchat groups leave <groupId>          # 离开群组
sc-vrchat groups announcement <groupId>   # 查看群组公告
sc-vrchat groups announce <groupId> <message>  # 发布群组公告
```

### 文件(`files`)

```bash
sc-vrchat files get <fileId>              # 按 ID 获取文件
sc-vrchat files list                      # 列出当前用户文件(--n --offset)
sc-vrchat files create <name> <mimeType> <extension>  # 创建文件
sc-vrchat files create-image <name> <mimeType> <extension>  # 创建图片文件
sc-vrchat files delete <fileId>           # 删除文件
```

### 权限(`permissions`)

```bash
sc-vrchat permissions list                # 全部权限位
sc-vrchat permissions get <permissionId>  # 按 ID 获取权限位
```

### 系统(`system`)

```bash
sc-vrchat system health                   # 健康检查(需登录)
sc-vrchat system stats                    # 在线人数(无需登录,返回数字)
sc-vrchat system time                     # 服务器时间(无需登录,返回 ISO 字符串)
```

### 经济(`economy`)

```bash
sc-vrchat economy balance <userId>        # 用户余额
sc-vrchat economy transactions <userId>   # 用户交易记录(--n --offset)
```

### 审核(`moderation`)

```bash
sc-vrchat moderation list --type block    # 玩家管理列表(--type)
sc-vrchat moderation create mute <userId> # 创建玩家管理(静音/封禁等)
sc-vrchat moderation unmoderate mute <userId>  # 解除玩家管理
sc-vrchat moderation report <reportedUserId>  # 举报用户
```

### 邀请(`invite`)

```bash
sc-vrchat invite invite <userId> <worldId> <instanceId>  # 邀请用户到实例
sc-vrchat invite request <userId>        # 请求加入对方所在实例
sc-vrchat invite join <worldId> <instanceId>  # 自己加入实例
sc-vrchat invite respond <notificationId> <yes|no>  # 响应邀请
```

### 快捷消息(`messages`)

```bash
sc-vrchat messages list <userId> <type>   # 快捷消息列表(type: message/response/request/requestResponse)
sc-vrchat messages get <userId> <type> <slot>  # 获取槽位快捷消息
sc-vrchat messages update <userId> <type> <slot> <text>  # 更新槽位快捷消息
```

## 输出

默认输出 JSON(`--json` 为默认,无需显式传)。示例:

```json
{ "loggedIn": false, "message": "未登录,请运行 sc-vrchat login" }
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
