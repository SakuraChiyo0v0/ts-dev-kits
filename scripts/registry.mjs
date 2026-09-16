import { spawnSync } from "node:child_process";
import semver from "semver";

export const REGISTRY = "https://npm.pkg.github.com/";

export function runTool(command, args, options = {}) {
  if (process.platform !== "win32") return spawnSync(command, args, options);
  // .cmd 由 cmd.exe 执行；拒绝 shell 展开字符，路径中的空格用引号保护。
  const quote = value => {
    if (/["%！!&|<>^\r\n]/u.test(value)) throw new Error("命令参数包含不支持的 shell 字符");
    return `"${value}"`;
  };
  if (!/^[a-z-]+$/u.test(command)) throw new Error("非法工具命令");
  return spawnSync("cmd.exe", ["/d", "/s", "/c", `${command}.cmd ${args.map(quote).join(" ")}`], {
    ...options, windowsVerbatimArguments: true,
  });
}

export function validateName(name) {
  if (!/^@sakurachiyo0v0\/[a-z0-9][a-z0-9-]*$/u.test(name)) throw new Error(`非法工具包名: ${name}`);
}

// 不输出 npm 原始错误内容，避免认证配置或凭据被日志带出。
export function decodeRegistryResult(result, label) {
  if (result.error || result.signal) throw new Error(`${label}: registry 命令无法执行或已超时`);
  let data;
  try { data = JSON.parse(result.stdout); } catch { /* 失败响应有时只在 stderr 中 */ }
  if (result.status !== 0) {
    let error = data?.error;
    if (!error) { try { error = JSON.parse(result.stderr)?.error; } catch { /* 无 JSON */ } }
    if (error?.code === "E404") return null;
    throw new Error(`${label}: registry 查询失败 (${error?.code ?? "UNKNOWN"})`);
  }
  if (data === undefined || data === null || data.error) throw new Error(`${label}: registry 返回无效 JSON`);
  return data;
}

export function createRegistry(run = runTool) {
  const cache = new Map();
  const query = (spec, field) => {
    const key = `${spec}:${field ?? "manifest"}`;
    if (!cache.has(key)) {
      const result = run("npm", ["view", spec, ...(field ? [field] : []), "--json", "--registry", REGISTRY], {
        encoding: "utf8", timeout: 60000, windowsHide: true,
      });
      cache.set(key, decodeRegistryResult(result, spec));
    }
    return cache.get(key);
  };
  return {
    manifest(name, version) {
      validateName(name);
      if (version !== undefined && !semver.valid(version)) throw new Error("需要精确的语义化版本");
      const data = query(version ? `${name}@${version}` : name);
      if (data === null) return null;
      if (data.name !== name || !semver.valid(data.version) || (version && data.version !== version)) {
        throw new Error(`${name}: registry 返回了不匹配的包或版本`);
      }
      return data;
    },
    versions(name) {
      validateName(name);
      const data = query(name, "versions");
      if (data === null) return [];
      const versions = typeof data === "string" ? [data] : data;
      if (!Array.isArray(versions) || versions.some(v => typeof v !== "string" || !semver.valid(v))) {
        throw new Error(`${name}: registry 版本列表无效`);
      }
      return versions;
    },
  };
}
