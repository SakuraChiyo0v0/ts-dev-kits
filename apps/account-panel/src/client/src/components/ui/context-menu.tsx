/**
 * 通用右键菜单：定位在鼠标处，点击外部 / Esc 关闭，危险项红色。
 * 用法：onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, items); }}
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** 危险操作（删除等）：红色。 */
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ContextMenuApi {
  /** 打开菜单（在 onContextMenu 里调用）。 */
  openMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  /** 关闭菜单。 */
  closeMenu: () => void;
  /** 渲染节点（放组件树任意位置）。 */
  renderMenu: () => React.ReactNode;
}

/** 右键菜单 hook：每模块一个实例，返回 open/close/render。 */
export function useContextMenu(): ContextMenuApi {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeTimer = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  // 延迟关闭：允许菜单项 onClick 先执行（先 onMouseDown 记录点击目标）。
  const scheduleClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMenu(null), 120);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const openMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setMenu({ x, y, items });
  }, []);

  const renderMenu = useCallback((): React.ReactNode => {
    if (menu === null) return null;
    return (
      <ContextMenu
        state={menu}
        onClose={closeMenu}
        scheduleClose={scheduleClose}
      />
    );
  }, [menu, closeMenu, scheduleClose]);

  return { openMenu, closeMenu, renderMenu };
}

function ContextMenu(props: {
  state: MenuState;
  onClose: () => void;
  scheduleClose: () => void;
}) {
  const { state, onClose, scheduleClose } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // Esc 关闭。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 点击外部关闭（用 mousedown 捕获，避免与菜单项点击冲突）。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  // 菜单贴边：超出视口时翻转。
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    let { x, y } = state;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - r.width - 8);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x, y });
  }, [state]);

  return (
    <div
      ref={ref}
      className="animate-scale-in fixed z-[70] min-w-44 rounded-xl border bg-popover p-1.5 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onMouseLeave={scheduleClose}
      onMouseEnter={() => {
        // 取消延迟关闭。
      }}
    >
      {state.items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          disabled={item.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClose();
            item.onClick();
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-40",
            item.danger === true
              ? "text-destructive hover:bg-destructive/10"
              : "text-foreground hover:bg-muted",
          )}
        >
          {item.icon !== undefined ? <span className="text-muted-foreground">{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
