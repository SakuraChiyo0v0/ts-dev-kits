/**
 * SDK 错误 → 工具错误消息的统一映射。
 *
 * 各 SDK 抛出的都是带 `code` 的统一错误类,这里按错误码给模型可读、
 * 已脱敏(不包含 SMTP 密码 / cookie / 连接串)的说明。未知错误回退到
 * Error.message(SDK 错误消息自身已脱敏)。
 */

/** 已知错误码 → 模型可读说明。 */
const ERROR_MESSAGE: Readonly<Record<string, string>> = {
  // 通用
  CONFIGURATION: "配置缺失或无效,请检查预设配置",
  NOT_FOUND: "未找到目标资源",
  UNKNOWN: "发生未知错误",
  // 登录态
  LOGIN_REQUIRED: "需要登录:请先完成扫码登录后再试",
  AUTH_EXPIRED: "登录态已过期,请重新扫码登录",
  AUTHENTICATION: "认证失败:请检查配置的账号凭据",
  // netease 合规红线
  PRIVILEGE_DENIED: "当前账号无权请求该品质,已拒绝(不降级)",
  TRIAL_ONLY: "返回的是试听片段,已拒绝下载不完整音频",
  // 网络 / 连接
  NETWORK: "网络请求失败,请检查网络连接后重试",
  CONNECTION: "连接失败:请检查目标服务或网络",
  DELIVERY: "投递失败,请稍后重试",
  // ffmpeg
  INVALID_INPUT: "输入文件无效或不是媒体文件",
  PROCESS_ERROR: "ffmpeg 进程执行失败,请检查输入文件与参数",
  TIMEOUT: "操作超时,已取消",
  CANCELLED: "操作已取消",
  // 链接解析(多平台共用:netease / bilibili 都会抛 INVALID_URL)
  INVALID_URL: "无法解析该链接,请确认链接格式正确且为受支持的平台(B 站 / 网易云音乐)",
  DOWNLOAD_FAILED: "下载失败,请检查网络或磁盘空间后重试",
  MERGE_FAILED: "音视频合并失败,请确认已安装 ffmpeg",
  UNSUPPORTED_TYPE: "该链接类型暂不支持",
  // lol
  CLIENT_NOT_RUNNING: "英雄联盟客户端未运行,请先启动游戏客户端",
  DISCOVERY_FAILED: "未能自动发现英雄联盟客户端连接",
  RATE_LIMIT: "请求过于频繁,请稍后重试",
  AUTH: "连接客户端认证失败",
};

/**
 * 把任意抛出的值转成一条模型可读、已脱敏的错误说明。
 * @param error - execute 中抛出的任意值。
 * @returns 单行错误说明(不含换行)。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      const known = ERROR_MESSAGE[code];
      if (known !== undefined) return known;
      return `${error.message} (${code})`;
    }
    return error.message;
  }
  return String(error);
}
