/**
 * BOOTH 端点常量 —— 逆向点,集中管理便于站点改版时单点更新。
 * 无官方公开 API;这些路径基于社区逆向与页面抓包,实现阶段用真实请求校准。
 */

export interface BoothEndpoints {
  /** 商品页路径模板:{lang} 语言前缀,{id} 商品 ID。 */
  itemPage: string;
  /** 下单端点(方法/路径)。 */
  orderCreate: { method: "POST"; path: string };
  /** 订单状态查询路径模板:{orderId}。 */
  orderStatus: string;
  /** 订单文件清单路径模板:{orderId}。 */
  orderFiles: string;
  /** 用户页(登录校验用)。 */
  userPage: string;
  /** 登录页。 */
  loginPage: string;
}

/** 默认端点(基于真实页面验证;下单/订单/文件端点待真实冒烟校准)。 */
export const DEFAULT_ENDPOINTS: BoothEndpoints = {
  itemPage: "/{lang}/items/{id}",
  orderCreate: { method: "POST", path: "/ajax/orders" },
  orderStatus: "/orders/{orderId}",
  orderFiles: "/orders/{orderId}/download",
  userPage: "https://accounts.booth.pm/orders",
  loginPage: "https://booth.pm/users/sign_in",
};

/** 语言前缀清单(商品页解析用)。 */
export const LANG_PREFIXES = ["ja", "en", "zh-cn", "zh-tw", "ko"] as const;
export type BoothLang = (typeof LANG_PREFIXES)[number] | string;

/** 替换路径模板中的 {key}。 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
