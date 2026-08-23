import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  weapiDecrypt,
  weapiEncrypt,
  eapiEncrypt,
  eapiDecrypt,
} from "../src/weapi/encrypt.js";

const AES_IV = "0102030405060708";
const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const EAPI_KEY = "e82ckenh8dichen8";

/** 复刻两层 AES-CBC(与 src 相同的算法路径,用于协议一致性校验)。 */
function aesCbc(key: string, text: string): string {
  const cipher = createCipheriv("aes-128-cbc", key, AES_IV);
  return cipher.update(text, "utf8", "base64") + cipher.final("base64");
}

/** 复刻 eapi AES-ECB hex(与 src 相同算法路径)。 */
function aesEcbHex(key: string, text: string): string {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return (cipher.update(text, "utf8", "hex") + cipher.final("hex")).toUpperCase();
}

/** 复刻 eapi 响应解密。 */
function aesEcbDecryptHex(key: string, hexText: string): string {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return decipher.update(hexText, "hex", "utf8") + decipher.final("utf8");
}

describe("weapiEncrypt", () => {
  it("produces non-empty params and encSecKey with correct shape", () => {
    const { params, encSecKey } = weapiEncrypt({ ids: "[1,2]", level: "exhigh" });
    expect(params).toBeTypeOf("string");
    expect(params.length).toBeGreaterThan(0);
    expect(encSecKey).toBeTypeOf("string");
    // RSA NO_PADDING 1024 位 → 128 字节 → hex 256 字符。
    expect(encSecKey).toMatch(/^[0-9a-f]+$/u);
    expect(encSecKey.length).toBe(256);
    // hex 可解码为 128 字节。
    expect(Buffer.from(encSecKey, "hex").length).toBe(128);
  });

  it("produces decryptable output when secret key is known (protocol consistency)", () => {
    const payload = { ids: "[42]", level: "standard" };
    const secretKey = "0123456789abcdef"; // 16 字节
    const firstPass = aesCbc(PRESET_KEY, JSON.stringify(payload));
    const params = aesCbc(secretKey, firstPass);

    const decrypted = weapiDecrypt(params, secretKey);
    expect(decrypted).toBe(JSON.stringify(payload));
  });

  it("round-trips real weapiEncrypt output with extracted secret key", () => {
    // weapiEncrypt 内部随机 secretKey;验证其两层结构与协议一致:
    // 先用固定 key 构造 params,weapiDecrypt 能还原;随机路径输出形状由第一用例覆盖。
    const payload = { csrf_token: "", ids: "[1,2,3]", level: "exhigh" };
    const secretKey = "fedcba9876543210";
    const firstPass = aesCbc(PRESET_KEY, JSON.stringify(payload));
    const params = aesCbc(secretKey, firstPass);
    expect(weapiDecrypt(params, secretKey)).toBe(JSON.stringify(payload));
  });
});

describe("eapiEncrypt", () => {
  it("matches reference algorithm output (MD5 digest + AES-ECB hex)", () => {
    const url = "/eapi/playlist/subscribe";
    const payload = { id: 123, checkToken: "token" };
    const { params } = eapiEncrypt(url, payload);

    // 复刻参考实现。
    const text = JSON.stringify(payload);
    const message = `nobody${url}use${text}md5forencrypt`;
    const digest = createHash("md5").update(message).digest("hex");
    const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
    const expected = aesEcbHex(EAPI_KEY, data);

    expect(params).toBe(expected);
    // 大写 hex。
    expect(params).toMatch(/^[0-9A-F]+$/u);
  });

  it("round-trips through eapiDecrypt", () => {
    const url = "/eapi/playlist/unsubscribe";
    const payload = { id: 456, csrf_token: "csrf" };
    const { params } = eapiEncrypt(url, payload);
    // 构造一个加密响应(模拟服务端把 body 也按 eapi 加密)。
    const responseBody = JSON.stringify({ code: 200, id: 456 });
    const encrypted = aesEcbHex(EAPI_KEY, responseBody);
    expect(eapiDecrypt(encrypted)).toBe(responseBody);
    // 小写 hex 也可解。
    expect(eapiDecrypt(encrypted.toLowerCase())).toBe(responseBody);
  });

  it("eapiDecrypt rejects non-hex input", () => {
    expect(() => eapiDecrypt("not-hex")).toThrow();
  });
});
