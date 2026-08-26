# @sakurachiyo0v0/netease-music

网易云音乐 SDK:自研 weapi/eapi 加密通道、二维码登录(基于 `@sakurachiyo0v0/account` 通用认证底座)、**权限感知的品质选择**与**试听拦截(硬规则)**的合规下载,以及**收藏夹管理**(账号信息/用户歌单/红心歌曲/歌单增删歌曲/订阅歌单)。支持单曲/歌单/专辑、歌词(LRC)、封面与 ID3 标签。

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
sc-netease login     # 二维码扫码登录并持久化登录态
sc-netease status    # 登录状态
sc-netease logout    # 删除登录态
sc-netease parse <url>          # 解析链接,输出歌曲清单
sc-netease download <url|id>    # 下载(默认品质 exhigh)
sc-netease download <url> --level lossless --output-dir ./music

# 收藏夹管理
sc-netease favorites                    # 列出用户歌单(含"我喜欢的音乐")
sc-netease likes                        # 列出红心(喜欢)歌曲 ID
sc-netease like <songId>                # 红心收藏一首歌
sc-netease unlike <songId>              # 取消红心收藏
sc-netease playlist-create <name>       # 创建歌单(--privacy 10 隐私)
sc-netease playlist-delete <playlistId> # 删除歌单
sc-netease playlist-add <pid> <songId...>    # 歌单添加歌曲
sc-netease playlist-remove <pid> <songId...> # 歌单移除歌曲
sc-netease subscribe <playlistId>       # 收藏歌单
sc-netease unsubscribe <playlistId>     # 取消收藏歌单
```

选项:`--auth-path <path>` / `--no-browser` / `--level` / `--output-dir` / `--no-lyric` / `--no-cover` / `--lyric-mode original|translated|both` / `--uid <uid>`(查他人歌单/红心)。

## API

### `createNeteaseClient(options)` → `NeteaseMusicClient`

| 选项 | 说明 |
| --- | --- |
| `cookie` | 显式 cookie 字符串(优先) |
| `authPath` | 未传 cookie 时从该 AuthStore 加载登录态 |
| `remote` | 可选远程登录态命名空间(配置中心加密域),登录态双写本地+远程,新机 `load()` 还原 |
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

### 收藏夹管理(需登录)

| 方法 | 说明 |
| --- | --- |
| `getAccountInfo()` | 当前账号信息(`{ userId, nickname, avatarUrl?, signature? }`) |
| `getUserPlaylists({ uid?, limit?, offset? })` | 用户歌单列表;`specialType=5` 为"我喜欢的音乐",`subscribed=true` 为收藏的他人歌单 |
| `getLikeList({ uid? })` | 红心(喜欢)歌曲 id 列表 |
| `checkLiked(ids)` | 批量检查是否已红心(注意:该接口有缓存延迟,分钟级,刚操作后可能返回旧值) |
| `likeSong(id)` / `unlikeSong(id)` | 红心收藏 / 取消红心收藏 |
| `addTracksToPlaylist(pid, ids)` / `removeTracksFromPlaylist(pid, ids)` | 歌单增删歌曲 |
| `subscribePlaylist(pid)` / `unsubscribePlaylist(pid)` | 收藏 / 取消收藏歌单(自己创建的歌单不可订阅) |
| `createPlaylist({ name, privacy?, type? })` | 创建歌单,返回新歌单 id(`privacy` 0 公开 / 10 隐私) |
| `deletePlaylist(pid)` | 删除歌单 |

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

### 登录态多端同步(远程加密命名空间)

登录态默认只存本地(`<配置根>/amechan/netease-music/auth.json`)。传入 `remote`(配置中心加密域)后,登录态**双写本地+远程(加密)**;新机先 `await store.load()` 从远程还原并回写本地缓存,再构造客户端;远程不可达时自动降级本地,不影响使用。

```ts
import { qrcodeLogin, AuthStore } from "@sakurachiyo0v0/account";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { createNeteaseClient, neteaseQrAdapter } from "@sakurachiyo0v0/netease-music";

const remote = createConfigCenter().namespace("auth", { encrypt: true }); // /amechan/secrets/auth

// 登录(双写本地+远程)
await qrcodeLogin({ adapter: neteaseQrAdapter(), store: new AuthStore({ platform: "netease-music", remote }) });

// 新机还原:先 load() 拉取远程回写本地,再构造客户端
await new AuthStore({ platform: "netease-music", remote }).load();
const client = createNeteaseClient({ remote });
```

> 协议注意点(已实测验证):匿名请求需自动附带 `os=pc; appver=8.9.70` 基础 cookie,否则被网易云风控拦截(`code -462`);weapi 加密的 `encSecKey` 是 hex(非 base64),明文为 secretKey 反转后前置补 0x00 到 128 字节。SDK 同时实现了 eapi 加密(`eapiEncrypt`/`eapiDecrypt`/`session.postEapi`),但收藏歌单接口实测老 eapi 路径已废弃(404),当前版本走 weapi 路径。

## 已知环境注意事项

- **11 位纯数字 id 会被显示层打码:** 对话/终端显示层会对连续 11 位纯数字(疑似手机号)自动把中间 4 位替换为 `****`。网易云歌单 id 恰好是 11 位数字,会被误伤(如 `181****6754`)。这**只是显示层行为,数据本身完整**——SDK 内部拿到的 id 一直是完整数字(逐字符打印可见 `1 8 1 9 5 1 0 6 7 5 4`)。**不要复制打码后的文本当参数传**(`Number("181****6754")` = NaN → "请求参数错误");请在脚本内部用完整数字 id 操作。

## 验证

```powershell
pnpm --filter @sakurachiyo0v0/netease-music typecheck && test && build
```

测试离线运行(本地 mock 网易云接口),weapi/eapi 加密、解析、权限/试听拦截、下载链路、收藏夹管理均有覆盖。真实接口冒烟:`NETEASE_SMOKE=1 pnpm --filter @sakurachiyo0v0/netease-music test`。
