/**
 * 主账号系统：注册 / 登录 / 会话。
 * 用户名 + 密码（scrypt 哈希），登录返回 session token（内存会话）。
 * 用户数据存 PG（users 表）；平台 token 仍走统一 auth 域（PG 后端）。
 */
import { Hono } from "hono";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v : fallback;
}

const pool = new Pool({ connectionString: envOr("PG_URL", "postgres://app:app@localhost:5432/app") });

void (async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  } catch {
    // PG 未就绪时忽略（后续请求会重试/报错）。
  }
})();

/** session token → userId（内存会话，单实例够用）。 */
const sessions = new Map<string, string>();

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

export const userRoutes = new Hono()
  /** POST /api/users/register —— 注册主账号。 */
  .post("/register", async (c) => {
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
    } catch {
      return c.json({ error: "用户名已存在" }, 409);
    }
  })
  /** POST /api/users/login —— 登录，返回 session token。 */
  .post("/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    try {
      const { rows } = await pool.query<{ id: string; username: string; password_hash: string }>(
        "SELECT id, username, password_hash FROM users WHERE username = $1",
        [username],
      );
      const user = rows[0];
      if (user === undefined || !verifyPassword(password, user.password_hash)) {
        return c.json({ error: "用户名或密码错误" }, 401);
      }
      const token = randomUUID();
      sessions.set(token, user.id);
      return c.json({ token, username: user.username });
    } catch {
      return c.json({ error: "登录失败" }, 500);
    }
  })
  /** GET /api/users/me —— 校验 token，返回用户信息。 */
  .get("/me", (c) => {
    const auth = c.req.header("authorization");
    const token = auth !== undefined && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (token === undefined) return c.json({ error: "未登录" }, 401);
    const userId = sessions.get(token);
    if (userId === undefined) return c.json({ error: "未登录" }, 401);
    return c.json({ userId });
  });
