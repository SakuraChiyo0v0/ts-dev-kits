# 账号面板 UX 用户友好化改造方案

> 状态：实施中
> 分支：feat/bilibili-kazumi-web
> 目标：让用户「不摸不着头脑」—— 导航清晰、反馈及时、空态有引导、交互直觉。
> 竞品调研：docs/ui-research-report.md（YesPlayMusic / VutronMusic / BiliPai / PiliPlus / Kazumi）

---

## 一、现状痛点清单（代码阅读所得）

### 1. 导航与信息架构
- 三模块导航模式不统一：网易云是「页面栈 + 底部播放栏」，B站/Kazumi 是「view 状态机 + 返回按钮」。
- 模块间切换必须退回「服务列表」，无全局导航（无侧边栏/顶栏 tab）。
- 页面栈无面包屑/层级指示，深层页面（如 B站收藏夹 → 内容）只靠「返回」兜底，容易迷路。
- 各模块 header 文案/图标风格不统一（音乐=红底 Music2、B站=红底 ListVideo、番剧=红底 Clapperboard，均为同一 primary 色）。

### 2. 反馈与状态
- toast 三处重复实现（App / BilibiliModule / KazumiModule），行为一致但代码重复、无统一类型（成功/失败/信息）。
- 空状态全是纯文本（「暂无记录」「暂无规则」「暂无集数」），无图标、无引导动作。
- loading 反馈不统一：网易云用 skeleton，B站用 skeleton，Kazumi 用纯文本（「搜索中（遍历多个番剧源，约需 20 秒）…」）。
- 搜索无 loading 细节、无取消、无结果数提示。

### 3. 交互细节（体验断裂点）
- `window.prompt`（重命名歌单）、`window.confirm`（删除歌单）——原生弹窗破坏整体视觉。
- B站播放器：无全屏、无倍速、无进度 hover 预览、无画中画、无音量滑条（只有静音开关）。
- B站播放器**无弹幕**——SDK 已有 `danmaku.list(cid)` 能力，完全未用。
- Kazumi 播放器只有原生 `controls`，无自定义控制、无全屏按钮封装。
- B站/Kazumi 无搜索历史（网易云有）。
- B站详情页选 P 后需手动点播放，无自动连播。

### 4. 首次使用引导
- 无 onboarding：用户进入 B站首页有 5 个入口按钮但无说明文字，不知从何开始。
- 番剧「规则管理」入口在 header 显著位置，对普通用户过技术化（应收入「设置」类次级入口）。
- 服务列表启动器只有 3 个格子，无模块简介。

### 5. PWA 与元数据
- `manifest.json` icons 为空数组，无 favicon/图标。
- 页面 title 固定「账号面板 · 网易云音乐」，不随模块/歌曲切换（网易云歌曲切换时会更新，其他模块不会）。

### 6. 可发现性
- 网易云 PlayerBar 的「更多」菜单里功能藏太深（音质/倍速/睡眠定时）。
- 键盘快捷键帮助（?）不易被发现。

---

## 二、改造方向（融合竞品调研结论）

> 调研核心结论：高分项目一致性规律 =「外壳唯一 + 双层导航 + 全局迷你播放器 + Token 化设计系统 + 12 状态合同 + 组件化空态/反馈 + 首次引导」。最高杠杆三件事：① 启动器改常驻侧边栏；② 统一状态组件；③ 全局迷你播放器 + 首次引导。

### A. 统一导航框架 ✅
- ✅ 全局 Toast / EmptyState / ConfirmDialog 组件已建（components/ui/）
- ✅ 常驻侧边栏（桌面 Rail）/ 底部 Tab（窄屏）：首页 + 三模块平级切换，模块保持挂载（hidden 切换）状态不销毁
- ✅ 模块内「服务列表」按钮统一改「首页」语义；网易云绑定页同步

### B. 统一反馈组件 ✅
- ✅ 全局 Toast（success/error/info 类型 + 自动消失 + 可关闭），三模块全部接入并标注类型
- ✅ EmptyState（图标 + 标题 + 说明 + 可选动作），三模块空态已替换（含 Kazumi 搜索无结果与「未搜索」区分）
- ✅ ConfirmDialog 替换 window.confirm/prompt（重命名/删除歌单）
- ✅ 破坏性操作二次确认：B站清空历史、下载历史清空、Kazumi 删除规则

### C. 播放器体验 ✅
- ✅ B站播放器：弹幕（SDK danmaku API + 分段拉取 + 开关 + 加载态）、倍速、音量滑条、全屏、选 P 自动切换
- ✅ Kazumi 播放器：点击播放/暂停、双击全屏、操作提示
- ✅ Esc 关闭全部弹窗（useEscToClose hook）

### D. 搜索体验 ✅
- ✅ B站/Kazumi 搜索历史（localStorage + 焦点下拉 + 一键清除 + 回填搜索）
- ✅ 搜索结果展示条数、空结果引导（「没有找到 X」+ 换关键词建议）

### E. 引导与可发现性 ✅
- ✅ 首次引导 Onboarding（3 屏，localStorage 标记，登录后展示）
- ✅ Kazumi「使用说明」帮助面板（右上角更多菜单）
- ✅ 番剧「规则管理」移入「更多」下拉菜单（次级入口）

### F. PWA 完善 ✅
- ✅ SVG 应用图标 + manifest icons 填充 + favicon + apple-touch-icon
- ✅ title 随模块/歌曲更新

### G. 无障碍 ✅
- ✅ prefers-reduced-motion 动效降级（全局 + Tilt 组件）
- ✅ 键盘 Esc 关闭弹窗（useEscToClose 全量接入）、Toast role=status/alert、ConfirmDialog/Onboarding role=dialog+aria-modal
- ✅ 搜索历史键盘可达（onClick + onMouseDown preventDefault）
- ✅ 全局快捷键守卫（不劫持按钮/弹窗/视频/全屏/非音乐模块），移除反直觉 ↑/↓ 切歌
- ✅ 登录表单语义化（form + Enter 提交 + loading + aria-label）

### H. 评审建议修复（三 agent 评审后）✅
- 🔴 全局快捷键守卫（评审1/3 双重点名）
- 🔴 移动端 PlayerBar 与底部 Tab 重叠（bottom-14 + pb-[5.5rem]）
- 🔴 圆角 Token 断裂（显式定义 2xl）+ 浅色 muted-foreground 对比度 #6e6e73
- 🔴 模块切换音频不对称：B站/番剧失活暂停（active prop + registerPause）
- 🟡 危险操作二次确认：B站清空历史 / 下载历史清空 / Kazumi 删除规则
- 🟡 ConfirmDialog 异步状态（Promise + loading + 失败恢复）
- 🟡 登录表单 Enter/loading/防重复提交
- 🟡 B站全屏含控制条（playerWrapRef）+ Kazumi 控件冲突（去单击保双击全屏）
- 🟡 三模块品牌色（module-netease/bilibili/kazumi CSS 变量）
- 🟡 网易云模块空态收口 EmptyState + 后端不可达错误态（连接失败 + 重试）
- 🟢 弹幕 seek 回退重播、睡眠定时到期 toast、Onboarding 全屏跳过、Toast role

---

## 三、执行计划
1. ✅ 竞品调研 → docs/ui-research-report.md
2. ✅ 基础组件：Toast / EmptyState / ConfirmDialog
3. ✅ B站弹幕 + 播放器增强（倍速/音量/全屏）
4. ✅ 常驻侧边栏导航框架（App 结构改造，模块保持挂载不销毁状态）
5. ✅ 搜索历史（B站/Kazumi，localStorage + 焦点下拉 + 一键清除）
6. ✅ 首次引导 onboarding + Kazumi 帮助面板 + 播放器手势 + PWA（图标/title）
7. ✅ 三个维度评审 agent（UX 逻辑 7/10 / 视觉 6.5/10 / 可用性 5.5/10）
8. ✅ 解决评审建议（P0-P2 全部落地），回归 `pnpm typecheck && pnpm build` 通过
