/**
 * 网易云音乐 weapi 加密通道。
 * 所有 /weapi/* 接口的 POST 参数都需要经过两层 AES-CBC + RSA 加密:
 *
 *   1. 原文 JSON → 用固定 presetKey AES-CBC 加密 → base64
 *   2. 第一步结果 → 用随机 secretKey AES-CBC 加密 → base64(params)
 *   3. secretKey → RSA(固定公钥,NO_PADDING)加密 → base64(encSecKey)
 *
 * 协议行为参考开源生态(Binaryify/NeteaseCloudMusicApi)多年验证的公开协议,
 * 代码为自研实现:公钥由 modulus/exponent 自构造 DER,不引入第三方加密库。
 */
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";

/** AES-CBC 固定 IV(协议常量)。 */
const AES_IV = "0102030405060708";
/** 第一层 AES 固定密钥(协议常量,16 字节)。 */
const PRESET_KEY = "0CoJUm6Qyw8W8jud";
/** RSA 公钥 modulus(协议常量,1024 位,前导 0x00)。 */
const RSA_MODULUS_HEX =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
/** RSA 公钥 exponent(协议常量)。 */
const RSA_EXPONENT_HEX = "010001";
/** secretKey 字符集(base62,与协议一致)。 */
const BASE62 =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** DER 编码一个长度字段(TLV 的 L)。 */
function encodeLength(length: number): Buffer {
  if (length < 128) {
    return Buffer.from([length]);
  }
  // 长格式:0x80 | 字节数,后跟长度字节(大端)。
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** DER 编码一个 INTEGER(TLV)。 */
function encodeInteger(data: Buffer): Buffer {
  // 若最高位为 1,补一个 0x00 表示正数。
  const body = (data[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0x00]), data]) : data;
  return Buffer.concat([Buffer.from([0x02]), encodeLength(body.length), body]);
}

/** DER 编码一个 SEQUENCE(TLV)。 */
function encodeSequence(children: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), encodeLength(children.length), children]);
}

/** 由 modulus/exponent 构造 PKCS#1 RSAPublicKey DER,再生成公钥对象。 */
function buildRsaPublicKey(): KeyObject {
  const modulus = Buffer.from(RSA_MODULUS_HEX, "hex");
  const exponent = Buffer.from(RSA_EXPONENT_HEX, "hex");
  const der = encodeSequence(Buffer.concat([encodeInteger(modulus), encodeInteger(exponent)]));
  return createPublicKey({ key: der, format: "der", type: "pkcs1" });
}

/** AES-CBC 加密(128 位)。 */
function aesEncrypt(key: string, text: string): string {
  const cipher = createCipheriv("aes-128-cbc", key, AES_IV);
  return cipher.update(text, "utf8", "base64") + cipher.final("base64");
}

/** AES-CBC 解密(128 位),用于测试还原。 */
export function aesDecrypt(key: string, cipherText: string): string {
  const decipher = createDecipheriv("aes-128-cbc", key, AES_IV);
  return decipher.update(cipherText, "base64", "utf8") + decipher.final("utf8");
}

/** 生成 16 字符 base62 随机 secretKey(协议要求 16 字节,服务端 AES 解密用)。 */
function generateSecretKey(): string {
  let result = "";
  for (let i = 0; i < 16; i += 1) {
    const index = Math.floor(Math.random() * BASE62.length);
    result += BASE62.charAt(index);
  }
  return result;
}

/**
 * weapi 加密一个 JSON 对象。
 * @returns { params, encSecKey } 两个字段都直接作为 POST form 字段提交。
 */
export function weapiEncrypt(payload: Record<string, unknown>): {
  params: string;
  encSecKey: string;
} {
  const text = JSON.stringify(payload);
  // secretKey 必须是 16 字节(16 个 base62 字符)。
  const secretKey = generateSecretKey();

  // 第一层:presetKey 加密原文;第二层:secretKey 加密第一层 base64。
  const firstPass = aesEncrypt(PRESET_KEY, text);
  const params = aesEncrypt(secretKey, firstPass);

  // RSA NO_PADDING:明文长度须等于 modulus 长度(128 字节)。
  // 协议要求对 secretKey 反转后前置补 0x00 字节到 128 字节。
  // 注意:encSecKey 输出 hex(不是 base64),与 weapi 协议一致。
  const reversed = Buffer.from(secretKey.split("").reverse().join(""), "utf8");
  const paddedKey = Buffer.concat([
    Buffer.alloc(128 - reversed.length),
    reversed,
  ]);
  const encSecKey = publicEncrypt(
    { key: buildRsaPublicKey(), padding: constants.RSA_NO_PADDING },
    paddedKey,
  ).toString("hex");

  return { params, encSecKey };
}

/** 用 secretKey 还原 weapi params(测试用;生产只需加密)。 */
export function weapiDecrypt(params: string, secretKey: string): string {
  // 第二层解密得到第一层 base64,再解第一层。
  const firstPass = aesDecrypt(secretKey, params);
  return aesDecrypt(PRESET_KEY, firstPass);
}
