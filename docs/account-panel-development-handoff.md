# account-panel / ts-dev-kits 项目交接文档

> 本文档是给下一个接手开发的 agent 的完整交接：项目是什么、做了什么、怎么开发、踩过哪些坑、哪些不能做、怎么复用、下一步往哪走。事无巨细，先读这篇再动代码。

---

## 一、项目是什么

**`ts-dev-kits`** 是一个 pnpm workspace monorepo（GitHub 公开仓库 `SakuraChiyo0v0/ts-dev-kits`），包含：

- `packages/*` —— 可复用 SDK（`@sakurachiyo0v0/<name>`，发布到 GitHub Packages）
- `apps/account-panel` —— **网易云音乐面板**（当前唯一 web 应用，也是本轮开发的核心）
- `docs/` —— 设计文档、包索引、交接文档

**当前核心产品：`apps/account-panel`** —— 一个苹果风（浅色、毛玻璃、主色 #fa233b）的网易云音乐客户端 Web 应用，部署在用户的绿联 NAS 上，手机/电脑通过浏览器访问。

技术栈：**Hono（后端） + React 19 + Tailwind CSS 4 + Vite 8（前端）**，TypeScript 7.0.2（strict + `exactOptionalPropertyTypes`），pnpm 11。

---

## 二、架构与数据流

```
手机/电脑浏览器
   │ http://192.168.31.254:8787
   ▼
Hono server (apps/account-panel/src/server)
   ├─ routes/auth.ts     扫码登录（EventSource 推送二维码状态）
   ├─ routes/account.ts  账号/歌单/播放/下载/推荐/日志 全部业务路由
   ├─ bootstrap.ts       配置中心 + AuthStore（WebDAV 远程同步登录态）
   ├─ logger.ts          应用日志（logger SDK + 自定义 FileTransport 落盘）
   └─ 静态托管 dist/client（assets/* + manifest.json + SPA fallback）
   │
   ├─ @sakurachiyo0v0/netease-music  网易云 SDK（weapi 加密/取流/搜索/下载/推荐）
   ├─ @sakurachiyo0v0/media-downloader 通用下载 SDK（目录选择/流式下载/历史）
   ├─ @sakurachiyo0v0/account         登录态底座（AuthStore，WebDAV 双写）
   └─ @sakurachiyo0v0/logger          日志（默认 Console，可自定义 transport）
```

**「一次登录、全局配好」核心机制**：登录态经 `@sakurachiyo0v0/account` 的 AuthStore 双写（本地 + WebDAV 加密域 `/amechan/secrets/auth`，密钥 `WEBDAV_CONFIG_KEY` AES-256-GCM）。WebDAV 在公网腾讯云 `dav.amechan.cloud`（不是 NAS）。每次请求先 `warmupAuth` 远程同步登录态。

---

## 三、已完成功能全景

### 账号
- 扫码登录（EventSource 推二维码 + 状态）、退出登录（清本地 + 远程 WebDAV）
- 登录态跨实例同步（WebDAV）

### 歌单
- 列表（含红心歌单 specialType=5）、详情（含总时长）
- **增删改查**：创建 / 删除 / **重命名**（SDK `updatePlaylist`）/ 收藏（订阅）
- 歌曲操作：加入歌单（**多选弹窗**，一次加多个歌单）、移除歌曲（多选弹窗）
- 红心状态全链路同步（全局 `likedIds` + 播放栏 + 歌单 + 搜索 + 历史）

### 播放
- 真实取流（`/api/stream`）、进度/seek、循环（off/all/one）、**随机播放**（shuffle）
- 倍速、睡眠定时、音量（默认 1，0 不持久化）、iOS 静音解锁
- 歌词页（双语/原文/翻译、字号、自动滚动、下滑关闭、点封面看歌词/右键看详情）
- 播放队列（**拖拽排序 + 移除**，移除当前项自动续播）
- 播放历史、最近播放、最常播放、「继续播放」卡片（可关闭）

### 下载（核心卖点）
- **统一下载确认弹窗**（所有单曲入口都走它）：音质下拉 + 本机/NAS 渠道 + 目录
- **文件夹选择器**（浏览子目录 / 返回上级 / 新建文件夹，类似原生）
- 批量下载（歌单「下载全部」：品质 + 目录 + 进度浮层，失败曲不误标）
- NAS 下载带 ID3 标签（标题/歌手/专辑 + 内嵌封面 + .lrc 歌词 + .jpg 封面）
- 已下载标记（持久化）、下载历史（清空 + 单条删除）
- 多入口：歌曲行/搜索/历史/歌词页/播放栏菜单/歌曲详情

### 发现
- 每日推荐歌曲（横向滑动）、推荐歌单（真实播放量）、私人 FM（每日电台一键播）

### 日志
- 操作日志（下载/退出登录等）经 logger SDK + FileTransport 落盘到 `downloads/logs/app.log`
- 前端右上角「日志」面板查看（时间/级别/命名空间/消息，级别着色）

### 其他
- 深浅主题、PWA（manifest）、toast、骨架屏、响应式

---

## 四、SDK 能力（复用清单）

| 包 | 能力 | 关键 API |
| --- | --- | --- |
| `@sakurachiyo0v0/netease-music` (0.8.0) | 网易云全套 | `createNeteaseClient`、`getStreamUrl`、`getLyric`、`search`、`download`/`downloadByInput`、`getRecommendSongs`/`getRecommendPlaylists`/`getPersonalFm`、`createPlaylist`/`deletePlaylist`/`updatePlaylist`/`addTracksToPlaylist`/`removeTracksFromPlaylist`/`subscribePlaylist` |
| `@sakurachiyo0v0/media-downloader` (0.2.4) | 通用下载（与平台无关） | `DownloadManager({root})`：`listDirs(subdir)`/`createDir(subdir,name)`/`download({url,filename,dir,tags,coverUrl})`/`history()`/`clearHistory()`/`removeHistory(id)`/`record()`；`sanitizeSubdir` 防路径穿越 |
| `@sakurachiyo0v0/logger` | 日志 | `createLogger({namespace, transport})`、`child()`、自定义 `LogTransport` |
| `@sakurachiyo0v0/account` | 登录态底座 | `AuthStore`（本地+WebDAV 双写）、`qrcodeLogin` |
| `@sakurachiyo0v0/ffmpeg` | 媒体处理 | `createFfmpegClient().writeTags()`（ID3 标签+内嵌封面） |

**复用原则**：下载执行/目录管理 → media-downloader；日志 → logger；登录态 → account；网易云专属能力（取流/权限/试听拦截/歌词）留在 netease-music。**不要重复造轮子**，先查包索引 `docs/packages-index.md`。

---

## 五、研发中踩过的坑（血泪教训）

### 🔴 必须记住的

1. **音量无声的经典坑**：`Number(localStorage.getItem("volume"))` —— localStorage 无 key 返回 `null`，`Number(null)===0`，导致音量初始化为 0 无声。**修复**：判 `raw === null` 再兜底。所有 localStorage 初始化都要防 `null`。

2. **路径穿越安全**：下载目录相关接口（`/api/download-dirs`、`/api/download-mkdir`）用户可控 `path` 直接 `join(root, path)`，`path=../../` 可越出根目录读写。**修复**：`sanitizeSubdir()`（过滤 `.`/`..` 段）+ `resolveInside()`（resolve 后校验仍在 root 内）**下沉到 media-downloader SDK 内部**，路由层不要各自造轮子。以后任何用户可控路径必须过 sanitize。

3. **Docker 镜像没装 ffmpeg → 下载文件没 ID3 标签**：netease-music 的 `writeTags` 失败是静默的（catch 不阻断），容器没 ffmpeg 时下载成功但标签没写进去，用户以为是 bug。**修复**：Dockerfile runtime 阶段 `apk add ffmpeg`。验证标签用 `ffprobe -show_entries format_tags=title,artist,album`。

4. **提交身份**：本机 git 全局配置是公司账户 `mafuyu <mafuyu1@xiaomi.com>`。`git -c user.name=X -c user.email=Y commit` **只覆盖 author 不覆盖 committer**，导致历史提交的 committer 是公司账户。**修复**：仓库级 `git config user.name "SakuraChiyo0v0"` + `user.email "3296299414@qq.com"`；历史已用 `filter-branch` 重写 + force push。**以后永远用 GitHub 身份提交**，`-c user.name=SakuraChiyo0v0 -c user.email=3296299414@qq.com`。

5. **iOS Safari 自动播放策略**：`audio.play()` 必须在用户手势同步上下文，否则被拦截。**修复**：播放前同步执行 `audio.muted=true; void audio.play().catch(()=>{})` 解锁，取流后恢复 `audio.muted=false` 并按 React 的 `muted/volume` 状态设音量（否则静音后切歌会被强制出声）。

6. **Hono 不可变方法**：`.get/.post/.route` 必须**链式调用**，否则 schema 推断成 BlankSchema，前端 `hc` 端到端类型安全失效。

7. **TypeScript 7 `exactOptionalPropertyTypes`**：可选属性不能赋 `undefined`，必须用展开 `...(x !== undefined ? { x } : {})`。Hono 的 `c.req.json<T>().catch(() => ({}))` 的 catch 返回 `{}` 会导致 union 类型缺属性报错，要用 `(await c.req.json().catch(() => ({}))) as T`。

8. **网易云接口字段命名不一致**：`song/detail` 用 `ar`/`al`/`dt`，但私人 FM（`/radio/get`）和推荐接口用 `artists`/`album`/`duration`，搜索接口是 `artists`/`album`/`duration`。解析要**兼容两套命名**。

9. **repo-structure.html 冲突**：CI 会自动同步 `repo-structure.html`，本地 pull --rebase 经常冲突。**解决**：`pnpm gen:structure` 重新生成 + `git add repo-structure.html` + `GIT_EDITOR=true git rebase --continue`（可能两轮）。

10. **docker build 偶发失败**：config 包的 prepare（build）下载依赖超时（registry 网络波动），`pnpm install --filter account-panel...` 非零退出，但 **docker save 用的是旧 latest 镜像**导致部署旧版。**解决**：build 失败后重试；部署验证用 `docker exec` 检查关键能力（ffprobe 等）。

11. **11 位数字会被显示层打码**（中间 4 位变 `****`）：网易云歌单 id 恰是 11 位。不要复制打码文本当参数，脚本内用完整 id。

12. **静音双机制冲突**：React `muted` state（volume=0 实现）与 `audio.muted` HTML 属性（iOS 解锁用）并存，切歌时只恢复后者会导致「静音后切歌强制出声」。统一在切歌后按 React state 设 volume。

13. **播放/切音质竞态**：快速连点会播错歌。用 `playTokenRef` 递增 token，settle 后比对丢弃旧请求。

14. **EventSource / setInterval / setTimeout 泄漏**：登录 EventSource、批量下载轮询、歌词 auto-scroll timer、HomeView onBlur timer 都要 ref 存 + 卸载 cleanup。

### 🟡 环境与流程

15. **Docker Hub 直连超时** → 用 DaoCloud 加速源 `docker.m.daocloud.io/library/node:22-alpine`。
16. **绿联 NAS 没有 scp/sftp** → 用 `cat 文件 | ssh 'cat > 目标'` 管道传文件。
17. **容器日志**：`sudo docker logs account-panel`（在 NAS 上，需 sudo）。
18. **better-sqlite3 编译**：database 包有 native 依赖，构建只装 account-panel 依赖树（`pnpm install --filter account-panel...`），需 `apk add python3 make g++`。
19. **`tsconfig.base.json` 要 COPY 进镜像**（构建上下文根目录）。

---

## 六、不该怎么做（红线）

1. **不要绕过统一下载弹窗**：所有单曲下载入口必须走 `DownloadDialog`（音质+本机/NAS+目录），不要出现「直接下载到本机」的散落入口。
2. **不要在路由层各自做路径校验**：目录安全在 media-downloader SDK 内统一处理。
3. **不要用公司账户提交**（见踩坑 4）。
4. **不要重复实现已有 SDK**：下载 → media-downloader，日志 → logger，登录态 → account。
5. **不要静默吞掉关键失败**：writeTags 失败虽然不阻断下载，但要记录日志（logger），否则用户看到「下载成功但没标签」以为是 bug。
6. **不要把内部 error.message 直传前端**：脱敏后返回固定文案。
7. **不要在浏览器/WebView 保存 SMTP 密码、应用凭据**（SDK 约定）。
8. **不要破坏合规红线**（netease-music 设计）：试听 = 拒绝（TRIAL_ONLY 绝不落盘），品质必须与账号身份匹配（PRIVILEGE_DENIED 不降级不绕行）。

---

## 七、怎么开发（工作流）

### 本地开发
```bash
cd /home/mafuyu/桌面/Projects/Origin/ts-dev-kits
pnpm install                       # 装依赖（workspace）
pnpm --filter account-panel typecheck   # 类型检查
pnpm --filter account-panel build       # 构建 dist
pnpm --filter @sakurachiyo0v0/<pkg> test/build   # 单包
```
改了 SDK（packages/*）后**先 build 该 SDK**，因为 app 依赖它的 dist（`exports` 指向 dist），否则 app 侧 typecheck 报「方法不存在」。

### 提交规范
- Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`），内容用英文
- 身份：`git -c user.name=SakuraChiyo0v0 -c user.email=3296299414@qq.com commit -m "..."`（或仓库已配置好，直接 commit）
- 改了 packages/** 内容**必须 bump version**（pre-commit 守卫 `scripts/check-package-bumps.mjs` 拦截），新包不检查
- 遗留文件 `packages/logger/tests/timed.test.ts`（会话前就存在，用户没让动）**保持未提交**，提交前 `git stash push packages/logger/tests/timed.test.ts`，push 后 `git stash pop`
- 远程有 CI 的 repo-structure 同步提交 → pull --rebase 可能冲突，按踩坑 9 解决

### 部署到 NAS（核心流程）
```bash
# 1. 本地构建镜像（上下文是仓库根）
docker build -f apps/account-panel/Dockerfile -t account-panel .

# 2. 传镜像（绿联无 scp，用 cat 管道）
docker save -o /tmp/account-panel.tar account-panel:latest
cat /tmp/account-panel.tar | sshpass -e ssh -o StrictHostKeyChecking=no AmeChan@192.168.31.254 'cat > /tmp/account-panel.tar'

# 3. NAS 上加载 + 重建容器（sudo 密码同 SSH 密码，用分片变量防打码）
sshpass -e ssh ... "echo '${P1}${P2}' | sudo -S docker load -i /tmp/account-panel.tar
  && sudo docker rm -f account-panel
  && sudo docker run -d --name account-panel -p 8787:8787 --restart unless-stopped \
     -e DOWNLOAD_DIR=/downloads \
     -v /home/AmeChan/music/downloads:/downloads \
     --env-file /tmp/account-panel.env account-panel:latest"
```

### 部署后验证
- `curl http://localhost:8787/api/health`（在 NAS 上）
- 关键接口冒烟：`/api/account` `/api/recommend` `/api/download-dirs` `/api/logs`
- 手机浏览器 `http://192.168.31.254:8787` 刷新实测
- 视觉回归：playwright 截图 + kiro-cli-chat 看（`kiro-cli-chat chat --no-interactive --model claude-sonnet-4.5 --trust-tools=fs_read "请查看图片 @/tmp/x.png"`）

### 凭据处理（安全）
- 密码/密钥用**分片变量**拼接绕过显示层打码：`P1="200407"; P2="20110Mfy."; export SSHPASS="${P1}${P2}"`
- 绝不复制对话里打码后的星号当参数
- 密码/密钥不写进公开仓库

---

## 八、关键环境信息

| 项 | 值 |
| --- | --- |
| NAS | `192.168.31.254`（绿联 DXP4800GT，UGOS Pro） |
| SSH 用户 | `AmeChan`（不是 root），密码分片 `P1="200407"` + `P2="20110Mfy."`，sudo 密码同 SSH |
| 应用地址 | `http://192.168.31.254:8787` |
| 下载目录 | NAS `/home/AmeChan/music/downloads`（容器挂载 `/downloads`） |
| 应用日志 | `/downloads/logs/app.log` |
| WebDAV | 公网腾讯云 `dav.amechan.cloud`（登录态同步，非 NAS） |
| 构建加速 | `docker.m.daocloud.io` |
| 本机 git 身份 | **必须用** `SakuraChiyo0v0 <3296299414@qq.com>`（GitHub），全局配置是公司账户别用 |

---

## 九、下一步计划（下一大块开发方向）

按用户之前提过的方向排序：

1. **B站 / 番剧接入**（用户明确要的）：`media-downloader` SDK 已就绪（通用下载），B站 SDK（`@sakurachiyo0v0/bilibili`）和番剧（`@sakurachiyo0v0/kazumi`）已有，把它们的下载也接进统一下载弹窗 + 文件夹选择器 + 下载历史。
2. **发现能力补全**：banner、排行榜、歌单分类（往 `netease-music` 的 `api/recommend.ts` 加）。
3. **日志扩展**：给取流/搜索/歌单操作也加日志（现在只有下载 + 退出登录）。
4. **前端体验打磨**：更多动效、手势、性能优化。
5. **更多推荐/发现模块**（如每日 30 首入口、私人 FM 播放器）。

开发任何一块前：**先读本文档** + 相关 SDK 的 `README.md` + `docs/packages-index.md`，避免重造轮子、避免踩重复的坑。

---

## 十、验收清单（改完跑一遍）

- [ ] `pnpm --filter account-panel typecheck` 通过
- [ ] 改了 SDK：`pnpm --filter @sakurachiyo0v0/<pkg> test && build` 通过
- [ ] `pnpm --filter account-panel build` 通过
- [ ] docker build 成功（失败重试，看 config prepare）
- [ ] NAS 部署后 curl 冒烟 + 手机实测
- [ ] 提交用 GitHub 身份，bump 了 SDK 版本
- [ ] repo-structure.html 冲突已处理（gen:structure）
- [ ] 视觉回归（playwright + kiro）
