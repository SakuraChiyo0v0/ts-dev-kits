/**
 * 服务入口：启动 Hono 服务。
 * 环境变量：WEBDAV_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD / WEBDAV_CONFIG_KEY / PORT(默认 8787)。
 */
import { serve } from "@hono/node-server";
import app from "./app.js";

// 本地 dev 时自动加载 .env（若存在）；容器内用 -e 注入，无需 .env。
try {
  process.loadEnvFile?.();
} catch {
  // .env 不存在时忽略。
}

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[account-panel] listening on http://localhost:${info.port}`);
});
