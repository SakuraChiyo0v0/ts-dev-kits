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
# 只安装 account-panel 及其 workspace 依赖（跳过 database/better-sqlite3 等无关包）。
# install 会触发依赖包（config/account/netease-music 等）的 prepare 构建。
RUN pnpm install --filter account-panel...
RUN pnpm --filter account-panel build

# 生产精简：裁剪 devDependencies（react/vite/typescript/tailwind 等前端构建链运行期不需要），
# 并删除各包源码/测试，只保留 dist 与生产依赖，缩小 runtime 体积（COPY 层 286MB → ~150MB）。
# --ignore-scripts：各包 prepare/构建在上一步已完成，此处只裁剪不重跑。
RUN pnpm install --filter account-panel... --prod --ignore-scripts && \
    rm -rf /repo/packages/*/src /repo/packages/*/tests /repo/packages/*/test \
           /repo/apps/account-panel/src /repo/apps/account-panel/tests

FROM ${NODE_BASE} AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# ffmpeg/ffprobe：下载时写入 ID3 标签与内嵌封面所需。
# chromium：番剧加密源浏览器取流兜底（headless 解析 JS 动态生成的视频地址）。
RUN apk add --no-cache ffmpeg chromium nss freetype harfbuzz ca-certificates font-noto-cjk
# 复制裁剪后的 workspace（保持 pnpm 目录结构：符号链接、packages dist、app dist）。
COPY --from=build /repo /repo
WORKDIR /repo/apps/account-panel

EXPOSE 8787
CMD ["node", "dist/server/index.js"]