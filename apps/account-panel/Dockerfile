# 多阶段构建：monorepo 内构建 account-panel，产出极简运行时镜像。
# 构建上下文必须是仓库根（ts-dev-kits/），而非 apps/account-panel/。
# 用法：docker build -f apps/account-panel/Dockerfile -t account-panel .

FROM docker.m.daocloud.io/library/node:22-alpine AS base
RUN corepack enable && apk add --no-cache python3 make g++
WORKDIR /repo

# 先复制 workspace 清单与锁文件，利用 layer 缓存。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
# 复制全部 packages（SDK 依赖）与目标 app。
COPY packages ./packages
COPY apps/account-panel ./apps/account-panel

FROM base AS build
# 只安装 account-panel 及其 workspace 依赖（跳过 database/better-sqlite3 等无关包）。
# install 会触发依赖包（config/account/netease-music 等）的 prepare 构建。
RUN pnpm install --filter account-panel...
RUN pnpm --filter account-panel build

FROM docker.m.daocloud.io/library/node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# 复制整个 workspace（含 node_modules 符号链接、packages dist、app dist），保持 pnpm 目录结构。
COPY --from=build /repo /repo
WORKDIR /repo/apps/account-panel

EXPOSE 8787
CMD ["node", "dist/server/index.js"]
