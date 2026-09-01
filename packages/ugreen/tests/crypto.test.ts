import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import { md5Hex, rsaEncryptBase64 } from "../src/crypto.js";
import { deriveUgHost, resolveConfig, DEFAULT_BASE_DIR, DEFAULT_COOKIE_TTL_MS, DEFAULT_TIMEOUT_MS } from "../src/session.js";
import { sanitizeFilename } from "../src/client.js";
import { UgAppError, UgAppErrorCode } from "../src/errors.js";

describe("crypto", () => {
  it("rsaEncryptBase64 公钥加密后可用私钥还原", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const pubPem = publicKey.export({ type: "pkcs1", format: "pem" }).toString();
    const privPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const enc = rsaEncryptBase64(pubPem, "secret-password");
    const priv = forge.pki.privateKeyFromPem(privPem);
    const dec = priv.decrypt(forge.util.decode64(enc), "RSAES-PKCS1-V1_5");
    expect(dec).toBe("secret-password");
  });

  it("md5Hex 输出正确", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});

describe("deriveUgHost", () => {
  it("把 app-{proxyId}-{host}.ugapp.link 推导为 {host}.ug.link", () => {
    expect(
      deriveUgHost("app-fcbab9b4f9a92a3aa980-dxp4800gt-114a.cn30.ugapp.link", "fcbab9b4f9a92a3aa980")
    ).toBe("dxp4800gt-114a.cn30.ug.link");
  });
});

describe("resolveConfig", () => {
  const base = {
    appHost: "app-x-1.ugapp.link",
    proxyId: "x",
    username: "u",
    password: "p",
  };

  it("缺字段抛 VALIDATION", () => {
    expect(() => resolveConfig({ ...base, password: "" })).toThrow(UgAppError);
    try {
      resolveConfig({ ...base, password: "" });
    } catch (e) {
      expect((e as UgAppError).code).toBe(UgAppErrorCode.VALIDATION);
    }
  });

  it("baseDir 不以 / 开头抛 VALIDATION", () => {
    expect(() => resolveConfig({ ...base, baseDir: "DXP4800GT/AmeChan" })).toThrow(UgAppError);
  });

  it("默认值生效", () => {
    const r = resolveConfig(base);
    expect(r.baseDir).toBe(DEFAULT_BASE_DIR);
    expect(r.cookieTtlMs).toBe(DEFAULT_COOKIE_TTL_MS);
    expect(r.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe("sanitizeFilename", () => {
  it("替换 Windows 保留字符并去空白", () => {
    expect(sanitizeFilename('a/b:c*?"<>|.png')).toBe("a_b_c______.png");
    expect(sanitizeFilename("  clean.png  ")).toBe("clean.png");
    expect(sanitizeFilename("   ")).toBe("");
  });
});
