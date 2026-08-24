/**
 * 用户资料 —— /bbs/app/user/profile(需登录)。
 */
import { XiaoheiheHttpTransport } from "../transport.js";
import type { XiaoheiheProfile, XiaoheiheResponse } from "../types.js";

/** 用户查询域。 */
export class UserApi {
  constructor(private readonly transport: XiaoheiheHttpTransport) {}

  /** 按 UID 查询用户资料。 */
  async getProfile(userId: number | string): Promise<XiaoheiheProfile["user"] | undefined> {
    const body = await this.transport.request<XiaoheiheResponse<XiaoheiheProfile>>({
      path: "/bbs/app/user/profile",
      params: { userid: userId },
    });
    return body.result?.user;
  }
}
