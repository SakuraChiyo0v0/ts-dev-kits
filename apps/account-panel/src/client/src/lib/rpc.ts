import { hc } from "hono/client";
import type { AppType } from "../../../server/app.js";

/** Hono RPC 客户端：端到端类型安全（dev 经 Vite proxy，生产同源）。 */
export const rpc = hc<AppType>("");
