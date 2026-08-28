/**
 * 「SDK工具」设置页组件:各功能包的 enabled 开关。
 * 通过 settingsScope 的扁平 namespace(`dsh-sdk-tools`)读写,
 * 与 host 侧 src/settings.ts 的 SettingsSchema 一一对应。
 */

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { SettingsScope, SettingsScopeSnapshot } from "@deepseek-ai/dsh-client-runtime/client";
import styles from "./settings.module.css";

/** settings 文档里的扁平开关形状(与 host 侧 SettingsSchema 对应)。 */
export interface SettingsShape {
  bilibili: boolean;
  netease: boolean;
  ffmpeg: boolean;
  email: boolean;
  lol: boolean;
  vrchat: boolean;
  kazumi: boolean;
}

/** 每行功能开关的展示信息。 */
interface FeatureRow {
  key: keyof SettingsShape;
  label: string;
  description: string;
  hint?: string;
}

const FEATURES: readonly FeatureRow[] = [
  { key: "bilibili", label: "bilibili", description: "B站视频/音频解析与下载" },
  { key: "netease", label: "网易云音乐", description: "解析下载、账号与歌单管理" },
  { key: "ffmpeg", label: "ffmpeg", description: "媒体探测、转码、抽音频、截图" },
  {
    key: "email",
    label: "email",
    description: "SMTP 校验与发信",
    hint: "需先在预设配置填写 smtp(host/port/from)",
  },
  { key: "lol", label: "英雄联盟", description: "召唤师、战绩、段位查询", hint: "需本机运行游戏客户端" },
  { key: "vrchat", label: "VRChat", description: "用户与公开世界搜索", hint: "需本地 VRChat 登录态" },
  {
    key: "kazumi",
    label: "kazumi",
    description: "番剧规则采集与下载(搜索/线路/下载 mp4)",
    hint: "需先配置番剧规则(规则目录,用户自行导入)",
  },
];

/** apply 时由 index.tsx 绑定的 settings scope(绑定生命周期归插件 fiber)。 */
let scope: SettingsScope<SettingsShape> | undefined;

/** 绑定 scope(插件 apply 调用一次;fiber dispose 后引用悬空但组件已卸载)。 */
export function setSettingsScope(next: SettingsScope<SettingsShape>): void {
  scope = next;
}

/**
 * 设置页组件。宿主把 `settings.section` 的 owner props(close)传入;
 * 本页不主动关面板,忽略该 prop。
 */
export function SettingsPage(_props: { close: () => void }): ReactNode {
  const snapshot = useSyncExternalStore(
    (listener) => (scope === undefined ? () => {} : scope.subscribe(listener)),
    // scope 未绑定时返回 undefined(组件在读取前已早退),断言只是类型收窄。
    () => scope?.getSnapshot() as SettingsScopeSnapshot<SettingsShape>,
  );
  if (scope === undefined) {
    return <div className={styles.page}>设置服务未就绪…</div>;
  }
  if (snapshot.status === "loading") {
    return <div className={styles.page}>加载设置中…</div>;
  }
  if (snapshot.status === "unavailable") {
    return (
      <div className={styles.page}>
        <p className={styles.title}>SDK工具</p>
        <p className={styles.unavailable}>
          当前没有会话在使用 ts-dev-kits 预设,本插件的设置不可用。
          新建会话选择该预设后,此处可开关各功能包工具。
        </p>
      </div>
    );
  }
  const value = snapshot.value ?? FEATURES.reduce((acc, f) => ({ ...acc, [f.key]: false }), {} as SettingsShape);
  const toggle = (key: keyof SettingsShape, next: boolean): void => {
    if (!snapshot.writable) return;
    void scope?.set(key, next);
  };
  return (
    <div className={styles.page}>
      <p className={styles.title}>SDK工具</p>
      <p className={styles.subtitle}>
        开关 ts-dev-kits 各功能包工具;切换实时生效(写入 ~/.dsh/settings.yaml),
        未启用的功能不进 system prompt,0 token 开销。
      </p>
      {!snapshot.writable && <p className={styles.readonly}>当前连接为只读,开关不可用。</p>}
      <ul className={styles.list}>
        {FEATURES.map((feature) => (
          <li key={feature.key} className={styles.row}>
            <label className={styles.cell}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={value[feature.key] === true}
                disabled={!snapshot.writable}
                onChange={(event) => toggle(feature.key, event.target.checked)}
              />
              <span className={styles.name}>{feature.label}</span>
              <span className={styles.desc}>
                {feature.description}
                {feature.hint !== undefined && <em className={styles.hint}> · {feature.hint}</em>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
