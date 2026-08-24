/**
 * 请求签名 —— 对照 Go 参考实现(xhh/getkey.go)逐字节对齐。
 *
 * 每个请求携带三个签名参数:
 *   - `_time`  = 当前 unix 秒
 *   - `nonce`  = MD5(秒 + 加密随机数) 的大写 hex
 *   - `hkey`   = 7 字符(5 映射字符 + 2 位数字),由 `_time` / 请求 path / `nonce`
 *                经字符表替换、稳定排序、列优先交错、MD5 截断、mixed 位运算得到。
 *
 * hkey 只对 Path 计算(不含 query);POST 的 form body 不参与签名。
 * 算法为协议逆向,可能随小黑盒版本更新失效;所有常量集中在本文件。
 */
import { createHash, randomInt } from "node:crypto";

/** 字符映射母表:0-9 + A-Z 去掉 O,共 35 字符。 */
export const SIGN_TABLE = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";

// ---- 混淆原语(输入为 ASCII 码,输出 8 位值) ----

function vm(num: number): number {
  // Go: int(255 & ((uint16(num) << 1) ^ 27)) —— num&128 != 0 时
  if ((num & 128) !== 0) {
    return (((num << 1) ^ 27) & 255) >>> 0;
  }
  return num << 1;
}

function qm(num: number): number {
  return vm(num) ^ num;
}

function _m(num: number): number {
  return qm(vm(num));
}

function Ym(num: number): number {
  return _m(qm(vm(num)));
}

function Gm(num: number): number {
  return Ym(num) ^ _m(num) ^ qm(num);
}

/** mixed:6 元素位运算混洗,输出 6 元素。 */
function mixed(e: number[]): number[] {
  const t = new Array<number>(6);
  t[0] = Gm(e[0]!) ^ Ym(e[1]!) ^ _m(e[2]!) ^ qm(e[3]!);
  t[1] = qm(e[0]!) ^ Gm(e[1]!) ^ Ym(e[2]!) ^ _m(e[3]!);
  t[2] = _m(e[0]!) ^ qm(e[1]!) ^ Gm(e[2]!) ^ Ym(e[3]!);
  t[3] = Ym(e[0]!) ^ _m(e[1]!) ^ qm(e[2]!) ^ Gm(e[3]!);
  t[4] = e[4]!;
  t[5] = e[5]!;
  return t;
}

// ---- 字符替换 ----

/**
 * av:子表替换。子表取 key 的前 (len(key)+n) 个字符;对输入每个字符的
 * ASCII 码对子表长度取模后查表。Go 中 `for _, v := range str` 迭代 rune,
 * 本协议输入均为 ASCII,codePointAt 与 rune 一致。
 */
export function av(str: string, key: string, n: number): string {
  const sub = key.slice(0, key.length + n);
  let out = "";
  for (const ch of str) {
    const v = ch.codePointAt(0) ?? 0;
    out += sub[v % sub.length];
  }
  return out;
}

/** sv:全表替换(35 字符)。 */
export function sv(str: string, key: string): string {
  let out = "";
  for (const ch of str) {
    const v = ch.codePointAt(0) ?? 0;
    out += key[v % key.length];
  }
  return out;
}

/** NewStr:三串列优先交错(以最长串为界,越界跳过)。 */
function newStr(arr: string[]): string {
  let out = "";
  const longest = arr[2]!.length;
  for (let i = 0; i < longest; i += 1) {
    if (arr[0]!.length > i) {
      out += arr[0]![i];
    }
    if (arr[1]!.length > i) {
      out += arr[1]![i];
    }
    if (arr[2]!.length > i) {
      out += arr[2]![i];
    }
  }
  return out;
}

/**
 * nonce:MD5(秒字符串 + 加密随机数) 的大写 hex。
 * 随机数范围 [0, 当前毫秒时间戳),与 Go crypto/rand.Int 对齐。
 */
export function getNonce(seconds: number, nowMs: number): string {
  const random = randomInt(0, nowMs);
  const digest = createHash("md5").update(`${seconds}${random}`).digest("hex");
  return digest.toUpperCase();
}

/**
 * 计算 hkey / nonce / _time。
 * @param reqPath 请求路径(不含 query,如 "/bbs/app/link/tree")。
 * @param nowMs   当前毫秒时间戳(测试可注入)。
 */
export function getKeys(reqPath: string, nowMs = Date.now()): { hkey: string; nonce: string; time: number } {
  const seconds = Math.floor(nowMs / 1000);
  const nonce = getNonce(seconds, nowMs);

  const str1 = av(String(seconds), SIGN_TABLE, -2);
  const str2 = sv(reqPath, SIGN_TABLE);
  const str3 = sv(nonce, SIGN_TABLE);

  // 按长度升序稳定排序(Go 对 3 元素用插入排序,稳定;JS sort 对等长稳定)。
  const arr = [str1, str2, str3].sort((a, b) => a.length - b.length);

  const interleaved = newStr(arr);
  // 只取交错结果前 20 字节做 MD5,输出 32 位小写 hex。
  const md5hex = createHash("md5").update(interleaved.slice(0, 20), "latin1").digest("hex");

  const lastsix = md5hex.slice(-6);
  const lastsixArr = [...lastsix].map((ch) => ch.codePointAt(0) ?? 0);
  const mix = mixed(lastsixArr);
  const count = mix.reduce((sum, v) => sum + v, 0);
  const a = String(count % 100).padStart(2, "0");
  const s = av(md5hex.slice(0, 5), SIGN_TABLE, -4);

  return { hkey: `${s}${a}`, nonce, time: seconds };
}
