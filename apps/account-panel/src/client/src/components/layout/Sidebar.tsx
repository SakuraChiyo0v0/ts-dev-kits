import { Clapperboard, LayoutGrid, LogOut, Music2, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModuleId = "home" | "netease" | "bilibili" | "kazumi";

/**
 * 常驻导航：桌面端为左侧 Rail（图标 + 文案），窄屏折叠为底部 Tab。
 * 三模块平级切换，不销毁各自状态（由父组件保持挂载）。
 */
export function Sidebar(props: {
  username: string;
  active: ModuleId;
  onSelect: (m: ModuleId) => void;
  onLogout: () => void;
}) {
  const { username, active, onSelect, onLogout } = props;

  const items: Array<{ id: ModuleId; label: string; sub: string; icon: React.ReactNode }> = [
    { id: "home", label: "首页", sub: "服务总览", icon: <LayoutGrid className="h-5 w-5" /> },
    { id: "netease", label: "音乐", sub: "网易云", icon: <Music2 className="h-5 w-5" /> },
    { id: "bilibili", label: "哔哩哔哩", sub: "视频", icon: <Tv className="h-5 w-5" /> },
    { id: "kazumi", label: "番剧", sub: "Kazumi", icon: <Clapperboard className="h-5 w-5" /> },
  ];

  return (
    <>
      {/* 桌面端：左侧常驻导航 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-card/40 backdrop-blur-xl sm:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{username}</p>
            <p className="text-xs text-muted-foreground">统一账号面板</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                active === it.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-current={active === it.id ? "page" : undefined}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  active === it.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {it.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{it.label}</span>
                <span className="block truncate text-xs text-muted-foreground/80">{it.sub}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="border-t border-border/60 p-3">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </aside>

      {/* 窄屏：底部 Tab 导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border/60 bg-background/80 backdrop-blur-xl sm:hidden">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onSelect(it.id)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              active === it.id ? "text-primary" : "text-muted-foreground",
            )}
            aria-current={active === it.id ? "page" : undefined}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </nav>
    </>
  );
}
