/**
 * 扫码登录会话表（内存）。
 * 单实例够用；多实例需换 Redis（后续阶段）。
 * 会话持有 SSE 监听者集合，用于把二维码/状态变化实时推给前端。
 */
import type { LoginState } from "@sakurachiyo0v0/account";
import type { SSEStreamingApi } from "hono/streaming";

export interface AuthSession {
  id: string;
  platform: string;
  state: LoginState;
  qrDataUrl?: string;
  message?: string;
  listeners: Set<SSEStreamingApi>;
}

const sessions = new Map<string, AuthSession>();

export function createSession(platform: string): AuthSession {
  const id = crypto.randomUUID();
  const session: AuthSession = { id, platform, state: "waiting", listeners: new Set() };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): AuthSession | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, patch: Partial<AuthSession>): AuthSession | undefined {
  const session = sessions.get(id);
  if (session === undefined) return undefined;
  const updated: AuthSession = { ...session, ...patch, listeners: session.listeners };
  sessions.set(id, updated);
  return updated;
}

export function removeSession(id: string): void {
  sessions.delete(id);
}

/** 注册 SSE 监听者；返回一个卸载函数。 */
export function addListener(id: string, stream: SSEStreamingApi): () => void {
  const session = sessions.get(id);
  if (session === undefined) return () => {};
  session.listeners.add(stream);
  return () => session.listeners.delete(stream);
}

/** 向会话所有 SSE 监听者广播一条事件；单个连接失败静默忽略。 */
export async function broadcast(
  id: string,
  payload: { event: string; data: unknown },
): Promise<void> {
  const session = sessions.get(id);
  if (session === undefined) return;
  const data = JSON.stringify(payload.data);
  await Promise.all(
    [...session.listeners].map(async (stream) => {
      try {
        await stream.writeSSE({ event: payload.event, data });
      } catch {
        session.listeners.delete(stream);
      }
    }),
  );
}
