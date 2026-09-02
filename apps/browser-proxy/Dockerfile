# browser-proxy：headless Chromium 取流解析独立服务（account-panel 等的浏览器兜底）。
# 构建上下文是仓库根；本目录独立于 pnpm workspace（pnpm-workspace.yaml 已排除），用 npm 装依赖。
# 固定 node 基础 digest，保证大层跨构建可复现（chromium 层不随每次构建漂移）。
ARG NODE_BASE=docker.m.daocloud.io/library/node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_BASE} AS build
WORKDIR /app
# playwright 浏览器由容器内系统 chromium 提供，跳过 npm postinstall 下载。
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY apps/browser-proxy/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM ${NODE_BASE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
# chromium + 渲染依赖 + 中文字体（解析中文播放页/加密源需要）。
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates font-noto-cjk
COPY --from=build /app/node_modules ./node_modules
COPY apps/browser-proxy/server.mjs ./

EXPOSE 9222
CMD ["node", "server.mjs"]