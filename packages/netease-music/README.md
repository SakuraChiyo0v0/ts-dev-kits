# @sakurachiyo0v0/netease-music

网易云音乐下载 SDK:自研 weapi 加密通道、二维码登录(基于 `@sakurachiyo0v0/account` 通用认证底座)、**权限感知的品质选择**与**试听拦截(硬规则)**的合规下载。支持单曲/歌单/专辑、歌词(LRC)、封面与 ID3 标签。

## 合规说明(请务必阅读)

- **不涉及任何非 VIP 下载 VIP 歌曲的违规行为。** 取流接口由网易云服务端按账号身份裁决,SDK 不做绕过、不伪装会员。
- **试听 = 拒绝:** 取流响应出现试听特征(`freeTrialInfo` 或时长明显短于完整歌曲)→ 抛 `TRIAL_ONLY`,绝不落盘不完整音频。
- **品质与身份匹配:** 下载前用 song detail 的 `st/fee` + `vip/info` 计算"该账号实际可请求的品质清单",目标品质不在清单内 → 抛 `PRIVILEGE_DENIED`(严格模式,不降级不绕行)。实测规则:免费歌曲非 VIP 上限 `exhigh`(完整),VIP 可 `lossless`;VIP 歌曲非 VIP 只能拿到 standard 试听(`freeTrialInfo`),SDK 一律拒绝。

## 安装

```powershell
pnpm add @sakurachiyo0v0/netease-music@workspace:*
# 或
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/netease-music"
```

依赖 `@sakurachiyo0v0/account`(认证底座)与 `@sakurachiyo0v0/ffmpeg`(ID3 标签写入,需系统安装 ffmpeg)。

## 快速开始

```ts
import { createNeteaseClient } from "@sakurachiyo0v0/netease-music";

const client = createNeteaseClient({ authPath: "path/to/auth.json" });
const { songs } = await client.parse("https://music.163.com/song?id=123456");
await client.download(songs[0]!, {
  outputDir: "./downloads",
  level: "exhigh", // standard|higher|exhigh|lossless|hires
});
```

## CLI

```powershell
amechan-netease login     # 二维码扫码登录并持久化登录态
amechan-netease status    # 登录状态
amechan-netease logout    # 删除登录态
amechan-netease parse <url>          # 解析链接,输出歌曲清单
amechan-netease download <url|id>    # 下载(默认品质 exhigh)
amechan-netease download <url> --level lossless --output-dir ./music
```

选项:`--auth-path <path>` / `--no-browser` / `--level` / `--output-dir` / `--no-lyric` / `--no-cover` / `--lyric-mode original|translated|both`。

## API

### `createNeteaseClient(options)` → `NeteaseMusicClient`

| 选项 | 说明 |
| --- | --- |
| `cookie` | 显式 cookie 字符串(优先) |
| `authPath` | 未传 cookie 时从该 AuthStore 加载登录态 |
| `download` | 下载配置(并发/重试/默认输出目录) |
| `baseUrl` / `fetchImpl` | 测试用覆盖 |

### 客户端方法

| 方法 | 说明 |
| --- | --- |
| `parse(url)` | 解析歌曲/歌单/专辑链接 → `{ items, songs }`(歌单/专辑展开为歌曲清单) |
| `getSongInfo(id)` | 歌曲详情(标题/歌手/专辑/时长/封面) |
| `getVipInfo()` | 账号 VIP 信息 |
| `getAvailableLevels(id)` | 该账号对这首歌实际可请求的品质清单 |
| `download(item, options)` | 下载(权限预检 + 试听拦截强制),返回 `{ filePath, level, lyricPath?, coverPath? }` |
| `downloadByInput(input)` | 按链接或歌曲 ID 便捷下载 |
| `isLoggedIn` | 是否已登录(MUSIC_U cookie 存在) |

### `download` 选项

`outputDir` / `level`(默认 `exhigh`)/ `lyric`(默认 true)/ `lyricMode`(默认 both)/ `cover`(默认 true)/ `writeTags`(默认 true,写入 ID3/Vorbis 标签与内嵌封面)/ `onProgress`。

## 错误码(`NeteaseError.code`)

`NETWORK` / `API_ERROR` / `NOT_FOUND` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `PRIVILEGE_DENIED` / `TRIAL_ONLY` / `DOWNLOAD_FAILED` / `UNKNOWN`

## 登录

`login` 通过 `@sakurachiyo0v0/account` 的 `qrcodeLogin` + 本包 `neteaseQrAdapter()` 执行,凭证持久化到 `<配置根>/amechan/netease-music/auth.json`。网易云无 refresh_token 续期机制,登录态过期(MUSIC_U 失效)时重新 `login`。

```ts
import { qrcodeLogin, AuthStore } from "@sakurachiyo0v0/account";
import { neteaseQrAdapter } from "@sakurachiyo0v0/netease-music";

const store = new AuthStore({ platform: "netease-music" });
await qrcodeLogin({ adapter: neteaseQrAdapter(), store });
```

> 协议注意点(已实测验证):匿名请求需自动附带 `os=pc; appver=8.9.70` 基础 cookie,否则被网易云风控拦截(`code -462`);weapi 加密的 `encSecKey` 是 hex(非 base64),明文为 secretKey 反转后前置补 0x00 到 128 字节。

## 验证

```powershell
pnpm --filter @sakurachiyo0v0/netease-music typecheck && test && build
```

测试离线运行(本地 mock 网易云接口),weapi 加密、解析、权限/试听拦截、下载链路均有覆盖。
