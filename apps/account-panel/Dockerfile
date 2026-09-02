# 多阶段构建：monorepo 内构建 account-panel，产出运行时镜像。
# 构建上下文必须是仓库根（ts-dev-kits/），而非 apps/account-panel/。
# 用法：docker build -f apps/account-panel/Dockerfile -t account-panel .

# node:22-alpine 固定 digest：基础层跨构建可复现，避免 alpine 滚动更新导致
# 下方 chromium/ffmpeg 大层每次重建都变化（否则 NAS 每次更新都要整层重拉 ~900MB）。
ARG NODE_BASE=docker.m.daocloud.io/library/node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_BASE} AS base
RUN corepack enable && apk add --no-cache python3 make g++
WORKDIR /repo

# 先复制 workspace 清单与锁文件，利用 layer 缓存。
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
# 复制全部 packages（SDK 依赖）与目标 app。
COPY packages ./packages
COPY apps/account-panel ./apps/account-panel

FROM base AS build
# 完整安装（含 devDeps），install 触发 SDK prepare 构建 dist，随后构建 app。
RUN pnpm install --filter account-panel...
RUN pnpm --filter account-panel build

# 生产依赖层：全新只装 prod（不装 devDeps，.pnpm 干净无孤儿），保持 pnpm 布局。
FROM base AS prod
RUN pnpm install --filter account-panel... --prod --ignore-scripts
# 从 build 阶段覆盖构建产物：各 SDK dist + app dist（prod 层不带源码里的 dist）。
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/account-panel/dist /repo/apps/account-panel/dist
# 删除源码/测试，只留 dist 与生产依赖，缩小 runtime 体积。
RUN rm -rf /repo/packages/*/src /repo/packages/*/tests /repo/packages/*/test \
           /repo/apps/account-panel/src /repo/apps/account-panel/tests

FROM ${NODE_BASE} AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# ffmpeg/ffprobe：下载时写入 ID3 标签与内嵌封面所需。
# chromium 已拆分到独立服务 browser-proxy（apps/browser-proxy），本镜像不再携带。
RUN apk add --no-cache ffmpeg ca-certificates
# 复制 prod 层（生产依赖 + dist），保持 pnpm 目录结构。
COPY --from=prod /repo /repo
WORKDIR /repo/apps/account-panel

EXPOSE 8787
CMD ["node", "dist/server/index.js"]