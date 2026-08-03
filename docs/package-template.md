# 新依赖包模板

本文描述在 `ts-dev-kits` monorepo 中新增一个可复用依赖包时,目录与文件应该如何组织。参照物是已落地的 [`packages/email`](../packages/email)。

## 一句话流程

在 `packages/<name>/` 下创建源码、测试、构建配置和 README,包通过 pnpm workspace 加入根 lockfile,用根目录脚本 `pnpm check`(typecheck + test + build)统一验证。可复用包不发布到公共 npm registry,跨机器使用走 git 子目录依赖。

## 目录结构

```text
packages/<name>/
├─ src/                 # 源码(必选)
│  ├─ index.ts          # 公共入口,只导出应公开的 API
│  ├─ ...               # 按功能拆分模块
│  └─ providers/        # (仅适配器类包)每个供应商一个子目录
├─ tests/               # Vitest 单测(必选)
│  └─ helpers/          # 测试用本地服务/夹具(如本地 SMTP 服务器)
├─ scripts/             # 构建辅助脚本(如 clean.mjs)
├─ package.json         # 包元数据与构建/测试脚本
├─ tsconfig.json        # 开发与类型检查用
├─ tsconfig.build.json  # 仅输出声明文件
├─ tsconfig.bundle.json # 产物 bundle 用(ESM, 供 rollup)
├─ rollup.config.mjs    # ESM + CJS 双格式打包
├─ README.md            # 安装方式、API、参数表、错误码
└─ .gitignore           # (可选)仓库根 .gitignore 已覆盖 node_modules/dist 等
```

## 各文件职责

### `package.json`

| 字段 | 说明 |
| --- | --- |
| `name` | `@amechan/<name>`,沿用 `@amechan` scope |
| `version` | 语义化版本,`0.x.y` 起步 |
| `description` | 一句话说明包用途 |
| `license` | 未发布公共包用 `UNLICENSED` |
| `type` | `"module"`(源码是 ESM) |
| `sideEffects` | `false`,便于消费方 tree-shaking |
| `engines.node` | `>=20` |
| `main` / `module` / `types` | 分别指向 `dist/index.cjs` / `dist/index.js` / `dist/index.d.ts` |
| `exports` | 用 `types` / `import` / `require` 三种条件导出,`"."` 指向 dist |
| `files` | 只发布 `dist` 和 `README.md` |
| `scripts.build` | 先 `clean.mjs` → `tsc --project tsconfig.bundle.json` → `rollup` → `tsc --project tsconfig.build.json` → 清理中间产物 |
| `scripts.prepare` | `npm run build`(git 依赖安装时会触发构建,这是需要 pnpm 授权的原因) |
| `scripts.typecheck` | `tsc --noEmit` |
| `scripts.test` | `vitest run` |

构建产物的「干净」是关键:先临时编译到 `.build/`,rollup 产出 `dist/index.js`(ESM)与 `dist/index.cjs`(CJS),再单独跑一次 `tsc` 只生成 `.d.ts`。这样 ESM/CJS/类型三种消费方式都可用。

### `tsconfig.json`

继承根 `tsconfig.base.json`(strict + `NodeNext` + `exactOptionalPropertyTypes` 等),追加 `types: ["node"]`。开发时 `--noEmit` 做类型检查。

### `tsconfig.bundle.json` 与 `tsconfig.build.json`

两者都继承 `tsconfig.json`、只 `include: ["src/**/*.ts"]`、`exclude: ["tests"]`:

- `bundle`:声明关闭,`module: ESNext` + `moduleResolution: Bundler`,`outDir: .build`,给 rollup 提供临时 ESM 入口。
- `build`:只产声明,`emitDeclarationOnly: true`,`outDir: dist`,产出 `.d.ts`。

### `rollup.config.mjs`

以 `.build/index.js` 为输入,外部依赖(第三方如 `nodemailer`、`node:` 内置模块)声明为 external,输出 ESM 与 CJS 两个文件。

### `src/index.ts`

公共出口。值用 `export { ... }`,类型用 `export type { ... }`。只暴露稳定接口,内部实现细节不导出——这是「供应商无关接口 + 适配器」模式的关键。

### `src/types.ts` 与 `src/errors.ts`

- `types.ts`:核心接口(消息、配置、Provider、结果)。统一接口是上层调用稳定的基础。
- `errors.ts`:统一错误类 + 错误码枚举 + 底层错误归类函数。错误消息要脱敏,不泄露凭据。

### `tests/`

Vitest 测试。真实协议路径优先(如本地 `smtp-server` 起一个仅测试进程使用的服务器),而不是纯 mock;同时用 fake provider 测校验逻辑和客户端生命周期。`tests/helpers/` 放本地测试服务。

### `README.md`

必备内容:环境要求、安装方式(workspace / 本地目录 / git 子目录,含 pnpm `allowBuilds` 授权)、最小可运行示例、参数表、错误码表、验证命令。这是其他项目接入该包的第一手资料。

## 包间依赖

仓库内的包可以互相依赖。各 SDK 包共享构建配置,`packages/email` 与 `packages/ffmpeg` 的结构一致。

### 推荐方式:workspace 依赖

```json
// packages/<name>/package.json
"dependencies": {
  "@amechan/email": "workspace:*"
}
```

- `workspace:*` 始终取当前 workspace 内该包的最新版,开发时改动源码即生效,`pnpm install` 一次解析好依赖图。
- 需要跟随版本范围时可写 `workspace:^0.1.0`,发布后 `workspace:` 前缀会被替换为实际版本号(本仓库暂不发布,无此环节)。
- 只有 `packages/*` 下的 workspace 包能这样引用;外部项目不适用,应改用 git 子目录依赖。

### 依赖方向

保持依赖图单向、无环。A → B → A 会导致 pnpm 解析混乱。若两个包确有共享逻辑,把公共部分抽到第三个包,让 A、B 同时依赖它。

### 构建顺序

pnpm 按依赖解析的是构建产物:`@amechan/<name>` 的 `exports` 默认指向 `dist`。因此:

- 被依赖的包要先 `build`,依赖方再运行。开发时可用 `pnpm --filter @amechan/<name> build` 先构建依赖,或依赖方通过 `tsx`/vitest 直接跑源码(此时 import 的是依赖包构建产物)。
- 保持"只发 `dist` + README"的约定,不要用 `exports` 额外暴露 `./src/*`,否则每个消费方都要绑定源码布局。
- 仓库根 `build` 脚本逐包执行时注意先后:可在根 `package.json` 的 `build` 里按依赖顺序排列 `pnpm --filter` 调用。

## 与 monorepo 的接线

新增包后需要确认:

1. `pnpm-workspace.yaml` 已包含 `packages/*`,新包自动进入 workspace。
2. 运行 `pnpm install`,把新包写入 `pnpm-lock.yaml`。
3. 根 `package.json` 的 `typecheck` / `test` 用 `pnpm -r --if-present` 递归执行,新包无需改根脚本。
4. `build` 只对根列出的包执行:如需纳入根 `build`,在根 `package.json` 的 `build` 脚本里追加 `pnpm --filter @amechan/<name> build`。

## 新包验证清单

- [ ] `pnpm install` 后 lockfile 含新包
- [ ] `pnpm --filter @amechan/<name> typecheck` 通过
- [ ] `pnpm --filter @amechan/<name> test` 通过
- [ ] `pnpm --filter @amechan/<name> build` 产出 `dist/index.js`、`dist/index.cjs`、`dist/index.d.ts`
- [ ] `pnpm check` 全仓通过
- [ ] 在 `docs/packages-index.md` 总览表追加一行并补详情
