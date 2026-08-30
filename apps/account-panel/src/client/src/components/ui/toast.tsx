import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** 统一 Toast：全局单例（Provider 注入），三模块共用，带类型与自动消失。 */

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastApi {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 全局 Toast Provider：挂在应用根部，任何子组件可用 useToast()。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
      window.setTimeout(() => dismiss(id), 3000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* 堆叠在顶部中央，新消息在底部插入（最晚的贴顶展示）。 */}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-[90vw] animate-fade-in items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg backdrop-blur-xl",
              t.type === "success" && "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200",
              t.type === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
              t.type === "info" && "border-border bg-background/90 text-foreground",
            )}
            role={t.type === "error" ? "alert" : "status"}
            aria-live={t.type === "error" ? "assertive" : "polite"}
          >
            {t.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            ) : t.type === "error" ? (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-0.5 shrink-0 rounded-full p-0.5 text-current/60 transition-colors hover:text-current"
              aria-label="关闭提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 获取全局 Toast API。必须在 <ToastProvider> 内使用。 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error("useToast 必须在 <ToastProvider> 内使用");
  return ctx;
}
