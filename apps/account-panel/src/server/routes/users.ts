/**
 * 管理员登录：账号密码来自 Docker 环境变量（ADMIN_USERNAME / ADMIN_PASSWORD），
 * 不开放注册（公网防滥用）。登录返回带 TTL 的 session token。
 */
import { Hono } from "hono";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/** 启动时对管理员密码做一次 scrypt 哈希（运行时不再明文比较）。 */
const ADMIN_HASH: string | null =
  ADMIN_PASSWORD !== undefined && ADMIN_PASSWORD !== "" ? hashPassword(ADMIN_PASSWORD) : null;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (saltHex === undefined || hashHex === undefined) return false;
  try {
    const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
  } catch {
    return false;
  }
}

/** session token → { userId, expiresAt }（内存会话，单实例够用）。 */
const sessions = new Map<string, { userId: string; expiresAt: number }>();

function lookupSession(token: string): string | undefined {
  const session = sessions.get(token);
  if (session === undefined) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return session.userId;
}

export const userRoutes = new Hono()
  /** POST /api/users/login —— 管理员登录（校验环境变量账号）。 */
  .post("/login", async (c) => {
    if (ADMIN_USERNAME === undefined || ADMIN_HASH === null) {
      return c.json({ error: "管理员账号未配置" }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    // 时间侧信道防护：用户名不匹配也执行一次等价的 scrypt 校验。
    const userOk = username === ADMIN_USERNAME;
    const passOk = verifyPassword(password, ADMIN_HASH);
    if (!userOk || !passOk) {
      return c.json({ error: "用户名或密码错误" }, 401);
    }
    const token = randomUUID();
    sessions.set(token, { userId: "admin", expiresAt: Date.now() + SESSION_TTL_MS });
    return c.json({ token, username });
  })
  /** GET /api/users/me —— 校验 token，返回用户信息。 */
  .get("/me", (c) => {
    const auth = c.req.header("authorization");
    const token = auth !== undefined && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (token === undefined) return c.json({ error: "未登录" }, 401);
    const userId = lookupSession(token);
    if (userId === undefined) return c.json({ error: "未登录" }, 401);
    return c.json({ userId });
  })
  /** POST /api/users/logout —— 登出，作废 token。 */
  .post("/logout", (c) => {
    const auth = c.req.header("authorization");
    const token = auth !== undefined && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (token !== undefined) sessions.delete(token);
    return c.json({ ok: true });
  });
