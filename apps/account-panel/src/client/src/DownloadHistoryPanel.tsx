import { useCallback, useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { rpc } from "./lib/rpc";
import { cn } from "@/lib/utils";

interface DownloadRecord {
  id: string;
  filename: string;
  filePath: string;
  status: string;
  time: string;
}

export type DownloadPlatform = "netease-music" | "bilibili" | "kazumi";

/** 下载历史面板（按平台隔离：各模块传自己的 platform）。 */
export default function DownloadHistoryPanel(props: {
  onClose: () => void;
  platform: DownloadPlatform;
}) {
  const { onClose, platform } = props;
  const [records, setRecords] = useState<DownloadRecord[]>([]);

  const api =
    platform === "bilibili"
      ? rpc.api.bilibili["download-history"]
      : platform === "kazumi"
        ? rpc.api.kazumi["download-history"]
        : rpc.api["download-history"];

  const load = useCallback(async () => {
    try {
      const res = await api.$get();
      const data = (await res.json()) as { records?: DownloadRecord[] };
      setRecords(data.records ?? []);
    } catch {
      // 忽略。
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearAll = async () => {
    try {
      await api.clear.$post();
      setRecords([]);
    } catch {
      // 忽略。
    }
  };

  const remove = async (id: string) => {
    try {
      await api.remove.$post({ json: { id } });
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // 忽略。
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-slide-up rounded-t-2xl bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">下载历史（{records.length}）</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void clearAll()}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              清空
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        </div>
        <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
          {records.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  r.status === "done" ? "bg-emerald-500" : "bg-destructive",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.filename}</p>
                <p className="truncate text-xs text-muted-foreground">{r.filePath || "(失败)"}</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {new Date(r.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <button
                onClick={() => void remove(r.id)}
                className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                title="删除记录"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {records.length === 0 ? (
            <li className="py-10 text-center text-sm text-muted-foreground">暂无下载记录</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
