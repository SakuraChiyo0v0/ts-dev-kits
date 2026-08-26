# 网易云音乐下载 SDK + 通用认证底座设计

状态:用户已批准
日期:2026-08-23
> **2026-08-23 更新**:§11 预告的 bilibili 登录迁移已完成——bilibili 登录适配为 account 的 `QrLoginAdapter`(含 `refresh?` 续期钩子)并内聚于 bilibili 包,独立包 `bilibili-auth` 已删除,详见 [`2026-08-23-bilibili-login-migration-design.md`](2026-08-23-bilibili-login-migration-design.md)。

## 1. 当前问题与目标

仓库已有 `@sakurachiyo0v0/bilibili`(视频下载)+ `@sakurachiyo0v0/bilibili-auth`(扫码登录),但网易云音乐没有任何接入。用户需要一个与 bilibili 体验一致的网易云音乐资源下载 SDK,同时把登录做成**通用基地能力**,让 bilibili、网易云、酷狗、QQ 音乐等平台复用同一套登录态管理逻辑。

本次目标(两个新包):

- `@sakurachiyo0v0/account` — 通用认证底座(薄):跨平台登录态存储、扫码登录骨架、公共错误模型、配置目录解析;
- `@sakurachiyo0v0/netease-music` — 网易云音乐下载 SDK:登录(复用 account 底座)、解析、取流、下载、歌词、封面、ID3 标签、CLI。

**合规红线(用户明确要求):** 不涉及任何"非 VIP 下载到 VIP 歌曲"的违规行为;**试听 = 拒绝**——SDK 永不下载不完整的音频(试听片段),宁可抛错也不保存半首歌。品质选择必须与账号身份匹配。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 无网易云音乐接入 | `sc-netease download <url>` 一键下载单曲/歌单/专辑 |
| 无网易云登录 | `sc-netease login` 扫码即得,登录态持久化复用 |
| 无品质/权限感知 | 下载时按账号身份返回可请求品质清单,越权品质直接拒绝 |
| 试听片段被当完整歌曲 | 试听特征 → 抛错拒绝,绝不落盘不完整音频 |
| 每平台一套登录逻辑 | account 底座统一登录态管理,后续酷狗/QQ 音乐零成本接入 |

## 3. 方案选择

### 3.1 包结构:新包 account + 新包 netease-music(采用)

| 方案 | 结论 |
| --- | --- |
| 新包 `account`(薄底座)+ 新包 `netease-music`(下载 SDK) | **采用**:第一版即验证通用性;bilibili-auth 后续逐步迁移到 account 底座(API 不变) |
| 先做网易云包、后抽通用层 | 不用:后期抽离有破坏性改动 |
| 直接重构 bilibili-auth 为通用包 | 不用:改动面最大,一次到位但风险高 |

依赖方向:`netease-music` → `account`;`netease-music` → `ffmpeg`(ID3 标签写入,见 3.6)。单向无环。

### 3.2 登录方式:仅二维码登录(采用)

与 bilibili-auth 同款体验:本地窗口弹二维码 → 手机 App 扫码。不接触账号密码,合规性最好。

网易云二维码登录协议(参考 Binaryify/NeteaseCloudMusicApi 的协议行为,代码自研不抄;已对照 v4.32.0 源码实测验证):

1. `POST /weapi/login/qrcode/unikey`(weapi 加密,payload `{ type: 3 }`)→ `{ code: 200, unikey }`(unikey 在响应顶层);
2. 用 unikey 拼出扫码 URL(`https://music.163.com/login?codekey=<unikey>`),本地页面渲染二维码;
3. 轮询 `POST /weapi/login/qrcode/client/login`(weapi 加密,payload `{ key, type: 3 }`):
   - `800` 二维码过期(重新生成)、`801` 等待扫码、`802` 已扫待确认、`803` 登录成功;
   - 成功后响应头 Set-Cookie 含 `MUSIC_U`(核心登录态)、`__csrf` 等;
4. 落盘到 account 的 AuthStore。

> 协议注意点(实测):匿名请求需带 `os=pc; appver=8.9.70` 基础 cookie,否则被风控拦截(`code -462` "网络环境存在风险");weapi 加密的 `encSecKey` 为 **hex**(非 base64),且明文为 secretKey 反转后前置补 0x00 到 128 字节。

### 3.3 取流实现:自研 weapi 加密通道(采用)

网易云所有 `/weapi/*` 接口需要 AES-CBC + RSA 加密参数(AES key 随机生成、RSA 公钥固定、密钥以固定参数传递),这是取流、权限查询、VIP 查询等一切接口的前置。自研实现加密通道(纯 JS,参考协议行为,不引入 GPL 代码),不依赖第三方 API 服务。

不做内嵌 Binaryify/NeteaseCloudMusicApi 服务(GPL 许可证与本仓库 `UNLICENSED` 冲突 + 重型依赖);不做公开接口混合(高品质取流基本拿不到)。

### 3.4 品质与身份匹配(合规核心)

**服务端裁决是底线,SDK 不绕过、不伪装会员。** SDK 的职责是如实呈现并拦截:

| 机制 | 行为 |
| --- | --- |
| 权限预检 | 下载前查 `POST /weapi/v3/song/detail`(st/fee 字段)+ `POST /weapi/music-vip-membership/front/vip/info`(账号 VIP 等级),得到"该账号实际可请求的品质清单",只请求清单内品质。注:`/weapi/song/privilege` 已废弃(实测返回"接口未找到"),权限判断基于 detail 的 fee/st + vip/info |
| 品质映射 | `standard`(128k)/ `higher`(192k)/ `exhigh`(320k)/ `lossless`(FLAC)/ `hires`;按权限过滤。实测:`hires` 请求服务端统一降级为 `lossless`;免费歌曲非 VIP 上限 `exhigh`(完整),VIP 可 `lossless`;VIP 歌曲非 VIP 只能拿到 standard 试听 |
| 试听拦截(硬规则) | 取流响应出现试听特征 → 一律按"该账号无权下载完整歌曲"处理:响应带 `freeTrialInfo` 标记(实测:`{ fragmentType:-1, start:0, end:45 }`,128k 片段)、或返回 URL 时长明显短于歌曲完整时长 → 抛 `TRIAL_ONLY` 拒绝,绝不落盘不完整音频 |
| 越权品质 | 目标品质不在权限清单内 → 抛 `PRIVILEGE_DENIED`,不降级、不绕行(默认严格模式,行为可预期) |

**试听 = 拒绝,是硬性不变量:** 不存在"先下个试听再说"的路径;品质选择列表中不出现"试听"这一伪选项;`download()` 的 `level` 参数必须是完整品质之一,请求结果若被服务端降级为试听,同样按拒绝处理。

### 3.5 下载能力与输出

- **内容:** 单曲音频(核心)+ 歌单/专辑批量 + 歌词(LRC,可选原文/翻译)+ 封面图;
- **解析:** URL → `MediaItem[]`(歌曲/歌单/专辑三种类型),复用 bilibili 包的 Parser 模式;
- **输出格式:** 音频原样保留(普通品质 mp3、无损 flac、hires 原样),不转码;ID3 标签写入标题/歌手/专辑/封面(需 `ffmpeg` 包扩展,见 3.6);
- **文件组织:** 下载目录内 `歌手 - 标题.ext` + `同名.lrc` + `cover.jpg`(或按用户选项)。

### 3.6 ID3 标签写入:扩展 ffmpeg 包(采用)

现有 `@sakurachiyo0v0/ffmpeg` 无标签写入能力。两条路:

| 方案 | 结论 |
| --- | --- |
| 给 `ffmpeg` 包扩展 `writeTags()`(内部 `ffmpeg -i in -metadata ... -codec copy out`) | **采用**:复用现有 ffmpeg 进程封装,零新重型依赖;无损 flac 用 Vorbis comment,mp3 用 ID3v2 |
| 引入独立标签库(如 `node-id3` / `music-metadata`) | 不用:多一个原生/重型依赖,与仓库"轻依赖"风格不符 |

注意:ffmpeg 写 ID3v2 对 mp3 支持良好,flac 用 `-metadata` 写 Vorbis comment;若实现中发现 ffmpeg 对某格式标签支持不佳,再评估补充轻量库(设计阶段标注为开放点)。

### 3.7 CLI(采用)

```
sc-netease login    [--auth-path <path>] [--no-browser]
sc-netease status   [--auth-path <path>]
sc-netease logout   [--auth-path <path>]
sc-netease parse    <url> [--auth-path <path>]
sc-netease download <url|song-id> [--level <standard|higher|exhigh|lossless|hires>]
                         [--output-dir <dir>] [--lyric] [--no-cover] [--auth-path <path>]

# 收藏夹管理(需登录;authPath 缺省时自动从默认 AuthStore 加载)
sc-netease favorites                     [--uid <uid>]   # 用户歌单列表
sc-netease likes                         [--uid <uid>]   # 红心歌曲 ID
sc-netease like <songId> / unlike <songId>               # 红心收藏/取消
sc-netease playlist-create <name> [--privacy 10]         # 创建歌单
sc-netease playlist-delete <playlistId>                  # 删除歌单
sc-netease playlist-add <pid> <songId...>                # 歌单添加歌曲
sc-netease playlist-remove <pid> <songId...>             # 歌单移除歌曲
sc-netease subscribe / unsubscribe <playlistId>          # 收藏/取消收藏歌单
```

### 3.8 测试策略:离线 mock 为主 + 可选真实冒烟(采用)

| 层级 | 内容 |
| --- | --- |
| 离线单测(默认跑) | weapi 加密向量测试(已知明文/密文对);本地 mock HTTP 服务模拟登录 key/check、取流、权限、VIP、试听响应;下载落盘 + 标签验证 |
| 真实冒烟(可选开关,不默认) | `NETEASE_SMOKE=1` 时打真实接口,验证登录链路与真实取流;不进 CI 默认路径 |

## 4. 架构与数据流

### 4.1 account 包

```
packages/account/
├─ src/
│  ├─ index.ts        公共入口
│  ├─ errors.ts       AccountError + 错误码 + 归类函数
│  ├─ store.ts        AuthStore:平台命名空间路径、load/save/clear/exists、600 权限、原子写
│  ├─ qr-flow.ts      QrLoginFlow 骨架:生成 → 本地 server 页面 → 轮询 → 取凭证 → 落盘
│  ├─ types.ts        QrLoginAdapter 接口 + AuthData 通用形态
│  └─ paths.ts        resolveConfigRoot / defaultAuthPath(平台无关,复用 bilibili-auth 已验证逻辑)
├─ tests/
├─ package.json / tsconfig*.json / rollup.config.mjs / README.md
```

**QrLoginAdapter(平台实现契约):**

```ts
interface QrLoginAdapter {
  /** 平台名,如 "netease-music",决定 AuthStore 路径。 */
  readonly platform: string;
  /** 生成二维码,返回 key 与扫码 URL。 */
  generateKey(): Promise<{ key: string; url: string }>;
  /** 轮询扫码状态;成功时返回凭证(如 cookie 字符串 + 续期信息)。 */
  pollStatus(key: string): Promise<{
    state: "waiting" | "scanned" | "success" | "expired";
    credentials?: PlatformCredentials;
  }>;
  /** 可选:登录态续期(如 B 站 refresh_token 换新 cookie);无续期机制的平台省略。 */
  refresh?(credentials: PlatformCredentials): Promise<PlatformCredentials>;
  /** 凭证序列化/反序列化(平台专属字段,如 MUSIC_U / refresh_token)。 */
  serialize(credentials: PlatformCredentials): AuthPayload;
  deserialize(payload: AuthPayload): PlatformCredentials | null;
}
```

account 不感知具体平台,只提供骨架与存储。

### 4.2 netease-music 包

```
packages/netease-music/
├─ src/
│  ├─ index.ts           公共入口
│  ├─ client.ts          NeteaseMusicClient(createNeteaseClient)
│  ├─ errors.ts          NeteaseError + 错误码
│  ├─ types.ts           媒体/品质/权限/下载进度类型
│  ├─ weapi/
│  │  └─ encrypt.ts      AES-CBC + RSA 加密通道
│  ├─ auth/
│  │  ├─ adapter.ts      NeteaseQrAdapter(QrLoginAdapter 实现)
│  │  └─ session.ts      MUSIC_U/__csrf 加载与请求头注入
│  ├─ api/
│  │  ├─ song.ts         歌曲信息(详情/取流/VIP 等级/权限品质清单)
│  │  ├─ playlist.ts     歌单/专辑展开 + 歌词(LRC,原文/翻译)
│  ├─ parsers/
│  │  └─ url.ts          URL → MediaItem 解析(歌曲/歌单/专辑)
│  ├─ download/
│  │  ├─ stream.ts       取流 + 下载器(并发/重试/进度;writeTags 走系统临时目录规避 fuse rename 崩溃)
│  └─ cli/
│     └─ netease.ts      sc-netease 命令
├─ tests/
├─ package.json / tsconfig*.json / rollup.config.mjs / README.md
```

### 4.3 数据流

**download 命令:**

```
sc-netease download <url>
 → parse(url) → MediaItem[](歌曲 | 歌单展开为歌曲清单)
 → 检查 AuthStore 登录态(未登录 → LOGIN_REQUIRED 提示 login)
 → 每首歌:getDetail(id)(st/fee)+ vip/info → 权限品质清单
 → 校验目标 level 在清单内(不在 → PRIVILEGE_DENIED)
 → 取流 enhance/player/url/v1(encodeType=flac)→ 检查试听特征(freeTrialInfo/时长不匹配 → TRIAL_ONLY 拒绝)
 → 下载音频 + LRC + 封面 → writeTags() 写入 ID3 → 落盘
```

## 5. 接口设计

### 5.1 account

```ts
// 存储
class AuthStore {
  constructor(options: { platform: string; path?: string });  // 默认 <config>/amechan/<platform>/auth.json
  readonly path: string;
  load(): AuthPayload | null;      // 不存在/损坏 → null
  save(payload: AuthPayload): Promise<void>;  // 原子写 + 600
  clear(): Promise<void>;
  exists(): boolean;
}

// 扫码骨架
async function qrcodeLogin(options: {
  adapter: QrLoginAdapter;
  store?: AuthStore;              // 不传则按 adapter.platform 默认路径
  pollIntervalMs?: number;        // 默认 2000
  timeoutMs?: number;             // 默认 180_000
  maxRegenerates?: number;        // 默认 3
  openBrowser?: (url: string) => void | Promise<void>;
  autoOpenBrowser?: boolean;      // 默认 true
  fetchImpl?: typeof fetch;
  onStatus?: (status: LoginStatus) => void;
}): Promise<LoginResult>;          // { credentials, saved }

AccountError · code: NETWORK | API_ERROR | AUTH_EXPIRED | LOGIN_REQUIRED | UNKNOWN
```

### 5.2 netease-music

```ts
createNeteaseClient(options: {
  authPath?: string;        // 未显式传 cookie 时从该 AuthStore 加载
  cookie?: string;          // 显式优先
  baseUrl?: string;         // 覆盖 API baseUrl(测试/自定义网关)
  download?: { concurrency?: number; retries?: number };
  fetchImpl?: typeof fetch;
}): NeteaseMusicClient;

interface NeteaseMusicClient {
  parse(input: string): Promise<{ items: MediaItem[]; songs: MediaItem[] }>;
  parseItems(input: string): Promise<MediaItem[]>;          // 仅返回原始媒体项
  getSongInfo(id: string | number): Promise<SongInfo>;      // 标题/歌手/专辑/时长/封面
  getVipInfo(): Promise<VipInfo>;                           // { isVip, level, vipType }
  getAvailableLevels(id: string | number): Promise<QualityLevel[]>; // 按账号身份过滤
  download(item: MediaItem, options?: {
    outputDir?: string;
    level?: QualityLevel;          // standard|higher|exhigh|lossless|hires
    lyric?: boolean;               // 默认 true
    lyricMode?: "original" | "translated" | "both";
    cover?: boolean;               // 默认 true
    writeTags?: boolean;           // ID3/内嵌封面,默认 true
    onProgress?: (p: DownloadProgress) => void;
  }): Promise<DownloadResult>;      // { filePath, level, lyricPath?, coverPath? }
  downloadByInput(input: string, options?): Promise<DownloadResult>; // 链接或歌曲 ID
  readonly isLoggedIn: boolean;
  static qrAdapter(options?: { baseUrl?: string }): QrLoginAdapter;
}

// 收藏夹管理(需登录;全部为操作登录者自己的收藏/歌单,不影响下载合规)
interface NeteaseMusicClient /* 收藏夹 */ {
  getAccountInfo(): Promise<AccountInfo>;                    // uid/nickname/avatar
  getUserPlaylists(opts?: { uid?; limit?; offset? }): Promise<UserPlaylistSummary[]>;
  getLikeList(opts?: { uid? }): Promise<string[]>;           // 红心歌曲 id
  checkLiked(ids: (string|number)[]): Promise<Map<string, boolean>>; // 有缓存延迟
  likeSong(id: string|number): Promise<void>;
  unlikeSong(id: string|number): Promise<void>;
  addTracksToPlaylist(pid, trackIds): Promise<void>;         // /weapi/playlist/manipulate/tracks
  removeTracksFromPlaylist(pid, trackIds): Promise<void>;
  subscribePlaylist(pid): Promise<void>;                     // /weapi/playlist/subscribe(老 eapi 已 404)
  unsubscribePlaylist(pid): Promise<void>;
  createPlaylist(opts: { name; privacy?; type? }): Promise<string>; // 返回新歌单 id
  deletePlaylist(pid): Promise<void>;
}

NeteaseError · code:
  NETWORK | API_ERROR | NOT_FOUND | INVALID_URL | LOGIN_REQUIRED | AUTH_EXPIRED |
  PRIVILEGE_DENIED | TRIAL_ONLY | DOWNLOAD_FAILED | UNKNOWN
```

> **实现说明(与设计差异):** 权限接口为 `getAvailableLevels(id)` + `getVipInfo()`,不再有 `getPrivileges(ids)`(`/weapi/song/privilege` 已废弃);`parse()` 返回 `{ items, songs }`(歌单/专辑展开为 songs);`DownloadResult` 用 `level`(实际品质)而非 `actualLevel`。CLI 支持环境变量注入 `AMECHAN_NETEASE_BASE_URL` / `AMECHAN_NETEASE_AUTH_PATH`(测试与自定义网关)。

**品质类型:** `type QualityLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires"`,对应取流 `level` 参数与位率映射。

## 6. 错误处理与安全

- `NeteaseError` / `AccountError` 统一错误类 + 错误码,公开消息与日志脱敏:不打印 cookie、MUSIC_U、__csrf、unikey 本体;
- **试听拦截为硬规则**:`freeTrialInfo` 存在、或返回时长与歌曲时长差异超过阈值(如 < 90%)→ `TRIAL_ONLY`,拒绝落盘;
- 登录态过期(MUSIC_U 失效,接口返回 `-462`/`301` 等)→ `AUTH_EXPIRED` 提示重新 `login`(网易云无 refresh_token,不做自动续期;区别于 B 站);
- auth.json 原子写 + 600 权限;本地登录窗口仅监听回环地址 + 随机端口 + 一次性 token;
- 下载器:并发/重试/进度复用 bilibili 下载器模式;失败明确归因。

## 7. 测试

- **account:** AuthStore 路径解析(各平台/平台命名空间)、读写往返、权限、损坏容错;QrLoginFlow 状态机(adapter 注入 fake);错误模型;
- **netease-music:**
  - weapi 加密向量测试(固定明文 → 密文可解密回原文,参数结构正确);
  - 本地 mock HTTP 服务模拟:登录 unikey/check(801→802→803)、取流(正常/试听/无权限)、song detail(fee/st)、vip/info、歌词、歌单/专辑展开;
  - 试听拦截:freeTrialInfo 响应与短时长响应 → `TRIAL_ONLY`;
  - 权限预检:非 VIP 账号请求 lossless → `PRIVILEGE_DENIED`;
  - 下载:mock 取流落盘 + ID3 标签字段验证;
  - CLI:login/status/logout/parse/download 注入 fake 服务(环境变量 `AMECHAN_NETEASE_BASE_URL` 指向本地 mock,`AMECHAN_NETEASE_AUTH_PATH` 指向临时登录态);
- **可选真实冒烟:** `NETEASE_SMOKE=1` 时跑真实接口(登录态、歌曲详情、歌单解析、VIP、品质合规),不进默认 CI。

## 8. 明确不做(YAGNI)

- 手机号/邮箱/密码登录(第一版);
- 自动降级策略(严格模式,越权即拒绝;试听即拒绝);
- 多账号管理;
- 音频转码(原样保留);
- cookie 系统级加密;
- 歌单/专辑的"整包压缩导出";
- 下载后音质检测/去重库。

## 9. 依赖

- `account`:`qrcode`(纯 JS 二维码生成,零原生依赖)+ `@types/qrcode`(dev);
- `netease-music`:`@sakurachiyo0v0/account`(workspace:*)、`@sakurachiyo0v0/ffmpeg`(workspace:*)、`@sakurachiyo0v0/cli-utils`(workspace:*,CLI 解析);
- `ffmpeg` 包扩展 `writeTags()`(metadata 写入,无新运行时依赖);
- 不新增其它运行时依赖;加密用 Node 内置 `node:crypto`(AES/RSA 均可用,无第三方加密库)。

## 10. 后续可复用性(基地能力验证)

- **酷狗/QQ 音乐接入:** 只需各自实现 `QrLoginAdapter`(generateKey/pollStatus/serialize/deserialize),登录流程、存储、CLI login/status/logout 全复用;
- **bilibili-auth 迁移:** 后续将 bilibili 登录适配为 account 的 `QrLoginAdapter`(B 站有 refresh_token,Adapter 的续期钩子需支持——设计上预留 `refresh?` 可选钩子),API 对外不变;
- 文档:`docs/packages-index.md` 总览表追加 `account` 与 `netease-music` 两行并补详情。

## 11. 验证清单

- [x] `pnpm --filter @sakurachiyo0v0/account typecheck && test && build` 通过;
- [x] `pnpm --filter @sakurachiyo0v0/netease-music typecheck && test && build` 通过;
- [x] `pnpm --filter @sakurachiyo0v0/ffmpeg test` 通过(含新增 writeTags 测试);
- [x] `pnpm check` 全仓通过;
- [x] `sc-netease` CLI 注入假服务可跑通 login/status/logout/parse/download(`tests/cli.test.ts`);
- [x] `NETEASE_SMOKE=1` 真实接口冒烟通过(`tests/smoke.test.ts`);
- [x] 真实账号扫码登录 + 单曲/歌单下载 + 合规拦截(非 VIP 拒 VIP 歌)实测通过;
- [x] 收藏夹功能(§5.2 接口)真实账号实测通过:账号信息、用户歌单(含我喜欢的音乐)、红心列表、红心收藏/取消(歌单数 72→73→72 净零)、订阅/退订他人歌单、歌单增删歌曲、创建/删除歌单(全部自清理);
- [x] CLI 收藏夹子命令(favorites/likes/like/unlike/playlist-create/playlist-delete/playlist-add/playlist-remove/subscribe/unsubscribe)真实验证通过;
- [x] 修复:client 构造时 authPath 缺省也尝试从默认 AuthStore 加载(否则 CLI 无 --auth-path 时视为未登录);
- [x] `docs/packages-index.md` 已更新。
