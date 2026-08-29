/**
 * 管理员登录：账号密码来自 Docker 环境变量（ADMIN_USERNAME / ADMIN_PASSWORD），
 * 不开放注册（公网防滥用）。
 * 登录成功下发 httpOnly 持久 Cookie（7 天），session 存 PG（sessions 表，重启不丢）。
 * 无 PG_URL 时 session 回落内存。
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SESSION_COOKIE = "app_session";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/** 启动时对管理员密码做一次 scrypt 哈希（运行时不再明文比较）。 */
const ADMIN_HASH: string | null =
  ADMIN_PASSWORD !== undefined && ADMIN_PASSWORD !== "" ? hashPassword(ADMIN_PASSWORD) : null;

const pool: Pool | null =
  process.env.PG_URL !== undefined && process.env.PG_URL.trim() !== ""
    ? new Pool({ connectionString: process.env.PG_URL })
    : null;

/** 内存 session 兜底（无 PG 时）。 */
const memorySessions = new Map<string, { userId: string; expiresAt: number }>();

if (pool !== null) {
  void (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )`);
    } catch {
      // PG 未就绪时忽略。
    }
  })();
}

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

/** 校验 token 是否有效（PG 优先，否则内存）。 */
async function lookupSession(token: string): Promise<string | undefined> {
  if (pool !== null) {
    try {
      const { rows } = await pool.query<{ user_id: string }>(
        "SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()",
        [token],
      );
      if (rows[0] !== undefined) return rows[0].user_id;
      // 过期清理。
      await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
      return undefined;
    } catch {
      return undefined;
    }
  }
  const session = memorySessions.get(token);
  if (session === undefined) return undefined;
  if (session.expiresAt < Date.now()) {
    memorySessions.delete(token);
    return undefined;
  }
  return session.userId;
}

async function createSession(token: string, userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  if (pool !== null) {
    try {
      await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
        token,
        userId,
        expiresAt,
      ]);
      return;
    } catch {
      // PG 失败回落内存。
    }
  }
  memorySessions.set(token, { userId, expiresAt: expiresAt.getTime() });
}

async function deleteSession(token: string): Promise<void> {
  if (pool !== null) {
    try {
      await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    } catch {
      // 忽略。
    }
  }
  memorySessions.delete(token);
}

export const userRoutes = new Hono()
  /** POST /api/users/login —— 管理员登录，下发 httpOnly Cookie。 */
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
    await createSession(token, "admin");
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true, username });
  })
  /** GET /api/users/me —— 校验 Cookie，返回用户信息。 */
  .get("/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token === undefined) return c.json({ error: "未登录" }, 401);
    const userId = await lookupSession(token);
    if (userId === undefined) return c.json({ error: "未登录" }, 401);
    return c.json({ userId });
  })
  /** POST /api/users/logout —— 登出，作废 session 并清 Cookie。 */
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) await deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
