import { useEffect, useRef, useState } from "react";

/**
 * B 站风格弹幕层：在视频上方渲染滚动/顶部/底部弹幕。
 * 数据来自 /api/bilibili/danmaku（SDK danmaku.list），按播放时间驱动。
 */

export interface DanmakuItem {
  time: number;
  mode: number;
  color: number;
  text: string;
}

interface ActiveDanmaku {
  id: number;
  text: string;
  color: string;
  /** 顶部/底部弹幕固定，普通弹幕滚动。 */
  fixed: boolean;
  lane: number;
  durationMs: number;
}

const LANES = 8;
const SCROLL_MS = 7000;
const FIXED_MS = 3500;

function colorOf(rgb: number): string {
  if (rgb <= 0 || rgb > 0xffffff) return "#ffffff";
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

export function DanmakuOverlay(props: {
  items: DanmakuItem[];
  currentTime: number;
  paused: boolean;
}) {
  const { items, currentTime, paused } = props;
  const [active, setActive] = useState<ActiveDanmaku[]>([]);
  const nextId = useRef(1);
  const laneEnds = useRef<number[]>(Array(LANES).fill(0));
  // 记录已发射的弹幕索引，避免重复发射。
  const firedRef = useRef<number>(-1);
  const lastTime = useRef<number | null>(null);
  // 记录每个弹幕 id 的清理定时器。
  const timers = useRef<Set<number>>(new Set());

  useEffect(() => {
    const t = currentTime;
    // seek 回退检测：若当前时间比已发射的最远位置倒退超过 1 秒，
    // 重置水位到目标时间之前，使该位置的弹幕重新发射（对齐 B站「回退重放」习惯）。
    const lastTimeRef = lastTime.current;
    if (lastTimeRef !== null && t < lastTimeRef - 1) {
      // 找到第一个 time >= t-1 的弹幕索引，从那里重新发射。
      let resetTo = -1;
      for (let i = 0; i < items.length; i += 1) {
        const d = items[i];
        if (d !== undefined && d.time >= t - 1) {
          resetTo = i - 1;
          break;
        }
      }
      if (resetTo < 0 && items.length > 0) resetTo = items.length - 1;
      firedRef.current = resetTo;
      // 清空轨道占位，让新弹幕重新分配轨道。
      laneEnds.current = Array(LANES).fill(0);
    }
    lastTime.current = t;
    // 只发射 time ∈ [t-0.5, t] 且尚未发射过的弹幕（防止跳帧漏弹幕）。
    let emitted = false;
    for (let i = firedRef.current + 1; i < items.length; i += 1) {
      const d = items[i];
      if (d === undefined) continue;
      if (d.time > t + 0.5) break;
      if (d.time < t - 5) {
        // 跳过的弹幕（用户 seek），标记为已处理，不发射。
        firedRef.current = i;
        continue;
      }
      emitted = true;
      const fixed = d.mode === 5 || d.mode === 4;
      let lane = 0;
      if (!fixed) {
        let best = 0;
        for (let j = 1; j < LANES; j += 1) {
          if ((laneEnds.current[j] ?? 0) < (laneEnds.current[best] ?? 0)) best = j;
        }
        lane = best;
        const now = t;
        const end = Math.max(laneEnds.current[lane] ?? 0, now) + SCROLL_MS / 1000;
        laneEnds.current[lane] = end;
      }
      const item: ActiveDanmaku = {
        id: nextId.current++,
        text: d.text,
        color: colorOf(d.color),
        fixed,
        lane,
        durationMs: fixed ? FIXED_MS : SCROLL_MS,
      };
      setActive((prev) => [...prev.slice(-50), item]);
      const id = item.id;
      const timer = window.setTimeout(() => {
        setActive((prev) => prev.filter((a) => a.id !== id));
        timers.current.delete(timer);
      }, item.durationMs + 300);
      timers.current.add(timer);
      firedRef.current = i;
    }
    // 未发射任何弹幕时仍推进水位：跳过已过去的部分（避免重复扫描）。
    if (!emitted && items.length > 0) {
      while (firedRef.current + 1 < items.length) {
        const nxt = items[firedRef.current + 1];
        if (nxt !== undefined && nxt.time < t - 5) firedRef.current += 1;
        else break;
      }
    }
  }, [currentTime, items]);

  // 卸载时清理所有定时器。
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const timer of set) window.clearTimeout(timer);
      set.clear();
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {active.map((a) => (
        <span
          key={a.id}
          className="absolute whitespace-nowrap text-lg font-semibold leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          style={{
            color: a.color,
            top: `${((a.lane + 0.5) / LANES) * 100}%`,
            // 普通弹幕：从容器右缘外滚入、滚出容器左缘外（按容器宽度，非视口）。
            // 用 left 动画（而非 transform+视口宽度），保证与弹幕层容器尺寸一致。
            left: a.fixed ? "50%" : "100%",
            transform: a.fixed ? "translateX(-50%)" : undefined,
            ...(a.fixed
              ? {}
              : { animation: `danmaku-scroll ${a.durationMs}ms linear forwards` }),
            animationPlayState: paused ? "paused" : "running",
          }}
        >
          {a.text}
        </span>
      ))}
    </div>
  );
}
