/**
 * Steam Guard TOTP —— RFC6238 HMAC-SHA1 实现(Steam 手机令牌为 5 位 / 30 秒步长)。
 * 参考 steam-totp(MIT)算法:base32 解码 shared_secret → HMAC-SHA1 动态截断。
 */
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** base32 解码(忽略空格与 '=' 填充)。 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s=]/g, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const char of cleaned) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`无效的 base32 字符: ${char}`);
    }
    buffer = (buffer << 5) | value;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  /** 时间步长(秒),Steam 为 30。 */
  timeStepSeconds?: number;
  /** 验证码位数,Steam 为 5。 */
  digits?: number;
  /** 时间戳(毫秒),测试用。 */
  timestamp?: number;
}

/** 生成 Steam Guard 动态验证码(5 位)。 */
export function generateTotpCode(sharedSecretBase32: string, options: TotpOptions = {}): string {
  const timeStep = options.timeStepSeconds ?? 30;
  const digits = options.digits ?? 5;
  const timestamp = options.timestamp ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / timeStep);

  // 8 字节大端计数器。
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(sharedSecretBase32));
  const digest = hmac.update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  const code = binary % 10 ** digits;
  return String(code).padStart(digits, "0");
}
