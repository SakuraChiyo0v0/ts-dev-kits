import { describe, it, expect } from "vitest";
import { resolveConfigRoot, defaultAuthPath } from "../src/paths.js";
import { resolveConfigRoot as configRoot } from "@sakurachiyo0v0/config";
import { join } from "node:path";

describe("账号与配置路径规则一致", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    for (const env of [{}, { AMECHAN_CONFIG_HOME: "/custom" }, { APPDATA: "C:/appdata", XDG_CONFIG_HOME: "/xdg" }, { AMECHAN_CONFIG_HOME: "", APPDATA: "", XDG_CONFIG_HOME: "" }]) {
      it(`${platform} ${JSON.stringify(env)}`, () => {
        expect(resolveConfigRoot(platform, env)).toBe(configRoot(platform, env));
        expect(defaultAuthPath("bilibili", platform, env)).toBe(join(configRoot(platform, env), "amechan", "bilibili", "auth.json"));
      });
    }
  }
});
