/**
 * 服务入口：启动 Hono 服务。
 * 环境变量：PG_URL / CONFIG_KEY / ADMIN_USERNAME / ADMIN_PASSWORD / PORT(默认 8787)。
 */
import { serve } from "@hono/node-server";
import app from "./app.js";
import { initAppConfig } from "./bootstrap.js";

// 本地 dev 时自动加载 .env（若存在）；容器内用 -e 注入，无需 .env。
try {
  process.loadEnvFile?.();
} catch {
  // .env 不存在时忽略。
}

// 组合根：进程启动时初始化一次配置中心（PG 后端），后续路由经 config() 读默认。
initAppConfig();

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[account-panel] listening on http://localhost:${info.port}`);
});
