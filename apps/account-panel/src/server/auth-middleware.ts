/**
 * 面板会话鉴权中间件。
 *
 * 背景：此前 /api/bilibili、/api/kazumi 内部没有任何 cookie/session 校验，
 * 面板会话校验只存在于 users.ts —— 导致 /api/bilibili/proxy?url= 成为未鉴权的
 * 开放代理 / SSRF 出口。本中间件给这两个路由组统一挂上会话校验。
 *
 * 使用：在 app.ts 对 /api/bilibili/*、/api/kazumi/* 挂载本中间件。
 */
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { lookupSession, SESSION_COOKIE } from "./routes/users.js";

/** 校验管理员会话；未登录返回 401。 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token === undefined) return c.json({ error: "未登录" }, 401);
  const userId = await lookupSession(token);
  if (userId === undefined) return c.json({ error: "未登录" }, 401);
  c.set("userId", userId);
  await next();
};
