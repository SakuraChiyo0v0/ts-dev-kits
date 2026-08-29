/**
 * 主账号系统：注册 / 登录 / 会话 / 登出。
 * 用户名 + 密码（scrypt 哈希 + timingSafeEqual），登录返回带 TTL 的 session token。
 * 用户数据存 PG（users 表）；仅当设置 PG_URL 时启用（否则视为未配置主账号）。
 */
import { Hono } from "hono";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
// 时间侧信道防护：用户不存在时也执行一次等价的 scrypt 校验。
const DUMMY_HASH = (() => {
  const salt = randomBytes(16);
  const hash = scryptSync("dummy-password-for-timing", salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
})();

const pool: Pool | null =
  process.env.PG_URL !== undefined && process.env.PG_URL.trim() !== ""
    ? new Pool({ connectionString: process.env.PG_URL })
    : null;

if (pool !== null) {
  void (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    } catch {
      // PG 未就绪时忽略。
    }
  })();
}

/** session token → { userId, expiresAt }（内存会话，单实例够用）。 */
const sessions = new Map<string, { userId: string; expiresAt: number }>();

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
  /** POST /api/users/register —— 注册主账号。 */
  .post("/register", async (c) => {
    if (pool === null) return c.json({ error: "主账号未启用（未配置 PG_URL）" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username.length < 2 || password.length < 6) {
      return c.json({ error: "用户名至少 2 位，密码至少 6 位" }, 400);
    }
    try {
      await pool.query("INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)", [
        randomUUID(),
        username,
        hashPassword(password),
      ]);
      return c.json({ ok: true });
    } catch (err) {
      // 23505 = 唯一约束冲突（用户名已存在）；其他错误是服务端问题。
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
        return c.json({ error: "用户名已存在" }, 409);
      }
      return c.json({ error: "注册失败" }, 500);
    }
  })
  /** POST /api/users/login —— 登录，返回带 TTL 的 session token。 */
  .post("/login", async (c) => {
    if (pool === null) return c.json({ error: "主账号未启用（未配置 PG_URL）" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    let user: { id: string; username: string; password_hash: string } | undefined;
    try {
      const { rows } = await pool.query<{ id: string; username: string; password_hash: string }>(
        "SELECT id, username, password_hash FROM users WHERE username = $1",
        [username],
      );
      user = rows[0];
    } catch {
      return c.json({ error: "登录失败" }, 500);
    }
    // 时间侧信道防护：用户不存在时也执行一次等价的 scrypt 校验。
    const stored = user?.password_hash ?? DUMMY_HASH;
    const ok = verifyPassword(password, stored);
    if (user === undefined || !ok) {
      return c.json({ error: "用户名或密码错误" }, 401);
    }
    const token = randomUUID();
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return c.json({ token, username: user.username });
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
