import crypto from "node:crypto";
import forge from "node-forge";

/** 用 PEM 公钥按 RSA PKCS#1 v1.5 加密文本，输出 Base64（UGOS 登录链路要求） */
export function rsaEncryptBase64(pem: string, text: string): string {
  const pub = forge.pki.publicKeyFromPem(pem);
  return forge.util.encode64(pub.encrypt(text, "RSAES-PKCS1-V1_5"));
}

/** md5 十六进制（UGOS 一次性令牌请求的 X-Ugreen-Security-Key） */
export function md5Hex(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}
