import { describe, expect, it } from "vitest";
import { Config } from "../src/index.js";
import type { ResolvedConfig } from "../src/config.js";

/** Config() 返回输入侧类型;cast 成 ResolvedConfig 断言填充后的值。 */
function resolved(input: Parameters<typeof Config>[0]): ResolvedConfig {
  return Config(input) as ResolvedConfig;
}

describe("Config schema", () => {
  it("applies defaults when no config is given", () => {
    const config = resolved({});
    expect(config.bilibili.enabled).toBe(true);
    expect(config.bilibili.outputDir).toBe("~/Downloads/bilibili");
    expect(config.netease.enabled).toBe(true);
    expect(config.netease.level).toBe("exhigh");
    expect(config.ffmpeg.enabled).toBe(true);
    expect(config.lol.enabled).toBe(true);
    // email 默认关:无 SMTP 配置时不暴露工具(嵌套 object 缺省回退,host 为空)
    expect(config.email.enabled).toBe(false);
    expect(config.email.smtp?.host).toBeFalsy();
  });

  it("keeps explicit per-package overrides", () => {
    const config = resolved({
      bilibili: { enabled: false },
      email: {
        enabled: true,
        smtp: { host: "smtp.example.com", port: 465, secure: true, from: "a@example.com" },
      },
    });
    expect(config.bilibili.enabled).toBe(false);
    expect(config.email.enabled).toBe(true);
    expect(config.email.smtp?.host).toBe("smtp.example.com");
    expect(config.email.smtp?.port).toBe(465);
  });

  it("merges partial package configs with defaults", () => {
    const config = resolved({ netease: { level: "lossless" } });
    expect(config.netease.level).toBe("lossless");
    expect(config.netease.outputDir).toBe("~/Downloads/netease");
    expect(config.netease.enabled).toBe(true);
  });
});
