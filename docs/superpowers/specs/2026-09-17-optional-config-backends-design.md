# 账号依赖收敛与配置后端拆分

## 目标和已授权范围
用户批准尝试 account 与六个平台 SDK 解耦，以及 config-webdav/config-pg 两个按需安装适配包。数据库包的三种驱动拆分不在本轮。已有 ugreen 临时文件不动。不提交、不推送。

## 前后变化
平台 SDK -> account -> logger；远端只依赖 AuthRemoteStore 接口的 get/set/remove。
config 保留后端契约、命名空间、加密。WebDAV 和 pg 实现各自承担驱动依赖。
登录态文件路径、格式、远端优先读取/双写/失败降级和加密格式保持一致。

## 方案取舍
1. 只加子路径：不能消除必装依赖，不采用。
2. 独立适配包：依赖和职责明确，推荐。
3. 可选依赖兼容层：能保留旧导入，但增加加载和依赖循环处理成本。
用户已明确选择不做兼容、改新版本。config 升至 1.0.0：移除根入口 WebDAV/PG 导出，WebDAV 工厂和 CLI 移至 config-webdav；PgBackend 移至 config-pg。kazumi 和 database 的旧工厂调用必须迁移，保留其已有行为，数据库驱动拆分仍不在本轮。

## 接口和错误
AuthRemoteStore: get<T>(key): Promise<T>; set(key, unknown): Promise<void>; remove(key): Promise<void>。
现有 ConfigNamespace 结构兼容，无须包装；保留 NOT_FOUND 判断和超时降级。
路径规则由 account/config 各自轻量实现，一致性测试覆盖平台与环境变量。

## 验收
独立 tarball 消费检查安装树：本地账号和平台 SDK 无 config/webdav/pg；config 核心无驱动；适配包仅引入自身驱动。
严格类型、ESM/CJS、现有登录态、本地 WebDAV 明文/密文、远端降级验证。
PG 若没有独立测试服务，使用驱动替身验证参数与生命周期并明确真实连接未验证。
构建、受影响测试、全仓检查及发布清单/版本表更新。

## 实施结果

已按用户选择实施不兼容的 config 1.0 入口拆分。核心专项 81 项通过、1 项跳过；全仓构建/类型通过，串行全仓测试 1028 项通过、31 项跳过；四组实际 tarball 消费、CLI/skill/索引检查通过。PG 未连接真实服务；未提交、推送或发布。首次全仓运行受并行 pack 重建 dist 干扰，串行复跑后通过，详情归档在父工作区。
