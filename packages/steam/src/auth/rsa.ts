/**
 * 密码 RSA 加密 —— 用 GetPasswordRSAPublicKey 返回的公钥(mod/exp)做
 * RSA PKCS#1 v1.5 加密,base64 输出(与 steam-session / 官方客户端一致)。
 * 仅用 node:crypto,无第三方依赖。
 */
import { constants, createPublicKey, publicEncrypt } from "node:crypto";

/**
 * 加密密码。
 * @param password 明文密码
 * @param publicKeyMod 十六进制 modulus
 * @param publicKeyExp 十六进制 exponent(通常为 "010001")
 */
export function encryptPassword(password: string, publicKeyMod: string, publicKeyExp: string): string {
  const toBase64Url = (hex: string): string => Buffer.from(hex, "hex").toString("base64url");
  const jwk = {
    kty: "RSA",
    n: toBase64Url(publicKeyMod),
    e: toBase64Url(publicKeyExp),
  };
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const encrypted = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, "utf8"),
  );
  return encrypted.toString("base64");
}
