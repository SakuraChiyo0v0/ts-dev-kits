# config 1.0 与按需配置后端

此版本按用户决定不保留旧入口兼容层。升级时同步修改导入和创建方式；不迁移已有登录态、WebDAV 文件或 PG 数据。

| 旧用法 | 新用法 |
| --- | --- |
| config 导出 PgBackend | 从 config-pg 导入 PgBackend |
| createConfigCenter({ global }) | config-webdav 的 createWebdavConfigCenter(global) |
| createWebdavConfigCenter(path?) 从 config 导入 | 从 config-webdav 导入，同样支持配置文件路径 |
| config 导出 save/load/clearGlobalConfig、resolveConfigPath、GlobalConfig | 从 config-webdav 导入 |
| config 包提供 sc-config | 安装 config-webdav 后使用 sc-config |
| AuthStore.remote 依赖 ConfigNamespace | 只依赖 account.AuthRemoteStore，现有 namespace 对象可直接传入 |

config 的 createConfigCenter/initConfig 接收 `{ backend, key? }`；config(options) 同理。核心校验错误类改为 ConfigError，code 保持 VALIDATION。PgBackend 缺失键现在提供 code=NOT_FOUND，便于按契约处理。

只使用本地账号：安装 account 或平台 SDK 即可。WebDAV：额外安装 config-webdav。PG：额外安装 config/config-pg，并在退出时关闭 PgBackend。两个适配包都留在当前 monorepo。

account、bilibili、netease-music、booth、steam、vrchat、xiaoheihe 移除了 config 运行依赖，仅在开发测试中装配后端。默认登录态位置、读取优先级、远端双写和失败回退行为不变。

kazumi 规则同步与 database 的远端日志连接信息读取仍使用原有 WebDAV 功能，只把工厂导入迁到 config-webdav。这两包仍携带其既有后端依赖，本轮没有做 database 三驱动拆分。

发布清单新增两个适配包，并保证在实际依赖者之前发布。新版本尚需提交/推送后才能由 CI 发布；本地打包验证不代表 registry 已有这些版本。
