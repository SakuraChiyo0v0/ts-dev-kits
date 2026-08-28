/**
 * Hono 应用组装：API 路由 + 生产环境静态托管。
 * AppType 导出给前端 hc 做端到端类型安全。
 * 注意：Hono 的 .route/.use/.get 都是不可变方法，必须链式调用。
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/account.js";

const api = new Hono()
  .route("/auth", authRoutes)
  .route("/", accountRoutes)
  .get("/health", (c) => c.json({ ok: true }));

let app = new Hono().route("/api", api);

// 生产环境：托管前端静态资源 + SPA fallback（dev 时前端由 Vite 服务）。
if (process.env.NODE_ENV === "production") {
  app = app
    .use("/assets/*", serveStatic({ root: "./dist/client" }))
    .get("*", serveStatic({ path: "./dist/client/index.html" }));
}

export type AppType = typeof app;
export default app;
