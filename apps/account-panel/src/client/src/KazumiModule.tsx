import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ChevronLeft,
  Clapperboard,
  Download,
  HardDriveDownload,
  FilePlus2,
  Folder,
  FolderPlus,
  HelpCircle,
  History,
  ListChecks,
  Moon,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { rpc } from "./lib/rpc";
import DownloadHistoryPanel from "./DownloadHistoryPanel";
import { cn } from "@/lib/utils";
import { useTheme } from "./lib/use-theme";
import { parseSseEvent, splitSseChunks } from "./lib/kazumi-sse";
import { useToast } from "@/components/ui/toast";
import { useEscToClose } from "@/lib/use-esc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";

// ---------- 类型 ----------

interface SearchItem {
  name: string;
  src: string;
  rule: string;
}

interface Road {
  name: string;
  data: string[];
  identifier: string[];
  /** 线路质量（服务端从第一集 master playlist 探测），可选。 */
  quality?: { bandwidth?: number; resolution?: string };
}

interface Episode {
  name: string;
  url: string;
}

interface RuleItem {
  name: string;
}

/** 主页热门番剧推荐关键词（点击直接搜索）。 */
const HOT_ANIME = [
  "孤独摇滚",
  "鬼灭之刃",
  "咒术回战",
  "葬送的芙莉莲",
  "进击的巨人",
  "间谍过家家",
  "我推的孩子",
  "无职转生",
  "电锯人",
  "赛博朋克：边缘行者",
];

/** 分类标签（点击按分类搜索）。 */
const CATEGORIES = [
  "热血",
  "恋爱",
  "搞笑",
  "异世界",
  "日常",
  "治愈",
  "悬疑",
  "科幻",
  "奇幻",
  "校园",
];

/** 从线路名提取清晰度标记（与 SDK ROAD_QUALITY_RANKS 对应，供前端 badge 展示）。 */
function qualityBadge(name: string): string | null {
  if (/(8k|2160p|4k|uhd|超清4k)/i.test(name)) return "4K";
  if (/(1080p|1080|蓝光|bluray|bd|fhd)/i.test(name)) return "1080P";
  if (/(720p|hd|高清|超清)/i.test(name)) return "高清";
  if (/(480p|sd|标清|流畅|普清)/i.test(name)) return "标清";
  return null;
}

/** 码率可读化：1234567 → "1.2 Mbps"。 */
function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "";
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

// ---------- 主组件 ----------

export default function KazumiModule({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const { theme, toggle } = useTheme();
  const [view, setView] = useState<"home" | "rules" | "result">("home");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<{ done: number; total: number } | null>(null);
  // 源质量排名缓存（rule → 排名信息），搜索结果里直接展示。
  const [ruleRankings, setRuleRankings] = useState<Map<string, {
    score: number;
    successRate: number;
    downloadSuccessRate: number;
    avgBandwidth: number;
    avgSpeed: number;
  }>>(new Map());
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [roads, setRoads] = useState<Road[]>([]);
  const [roadIndex, setRoadIndex] = useState(0);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<Episode | null>(null);
  // 整部番批量下载进度（SSE 流式实时更新）。
  const [batchDownload, setBatchDownload] = useState<{
    done: number;
    total: number;
    failed: number;
    current?: string;
    failedEpisodes: Array<{ name: string; error: string }>;
  } | null>(null);
  // 整部下载的目标（弹路径选择对话框）。
  const [batchTarget, setBatchTarget] = useState<{ rule: string; title: string; episodes: Episode[] } | null>(null);
  const [showDownloadHistory, setShowDownloadHistory] = useState(false);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [m3u8Url, setM3u8Url] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);
  // 当前播放流的码率/分辨率（服务端从 master playlist 读取）。
  const [streamQuality, setStreamQuality] = useState<{ bandwidth?: number; resolution?: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // 流式搜索的取消控制器（换关键词/离开页面时中止上一轮）。
  const searchAbortRef = useRef<AbortController | null>(null);

  const toastApi = useToast();
  const showToast = useCallback(
    (message: string, type?: "success" | "error" | "info") => {
      toastApi.show(message, type);
    },
    [toastApi],
  );

  // 搜索历史（localStorage 持久化，最多 10 条）。
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("kazumi-search-history");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimerRef = useRef<number | null>(null);

  const recordSearch = (kw: string) => {
    setSearchHistory((prev) => {
      const next = [kw, ...prev.filter((h) => h !== kw)].slice(0, 10);
      try {
        localStorage.setItem("kazumi-search-history", JSON.stringify(next));
      } catch {
        // 忽略。
      }
      return next;
    });
  };

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  // 加载源质量排名，搜索结果里直接展示各源分数/码率/成功率。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await rpc.api.kazumi["rule-rankings"].$get();
        const data = (await res.json()) as { rankings?: Array<{
          rule: string;
          score: number;
          successRate: number;
          downloadSuccessRate: number;
          avgBandwidth: number;
          avgSpeed: number;
        }> };
        if (cancelled) return;
        const map = new Map<string, { score: number; successRate: number; downloadSuccessRate: number; avgBandwidth: number; avgSpeed: number }>();
        for (const r of data.rankings ?? []) {
          map.set(r.rule, {
            score: r.score,
            successRate: r.successRate,
            downloadSuccessRate: r.downloadSuccessRate,
            avgBandwidth: r.avgBandwidth,
            avgSpeed: r.avgSpeed,
          });
        }
        setRuleRankings(map);
      } catch {
        // 排名加载失败不影响搜索。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const playEpisode = useCallback(async (ep: Episode) => {
    if (selected === null) return;
    setPlayingEpisode(ep);
    setM3u8Url(null);
    setPlayError(null);
    setStreamQuality(null);
    setPlayLoading(true);
    try {
      const res = await rpc.api.kazumi.stream.$get({ query: { url: ep.url, rule: selected.rule } });
      const data = (await res.json()) as { m3u8Url?: string; error?: string; bandwidth?: number; resolution?: string };
      if (data.error !== undefined) {
        setPlayError(data.error);
        setPlayingEpisode(null);
      } else if (data.m3u8Url !== undefined) {
        setM3u8Url(data.m3u8Url);
        if (data.bandwidth !== undefined || data.resolution !== undefined) {
          setStreamQuality({ ...(data.bandwidth !== undefined ? { bandwidth: data.bandwidth } : {}), ...(data.resolution !== undefined ? { resolution: data.resolution } : {}) });
        }
      }
    } catch {
      setPlayError("播放失败");
      setPlayingEpisode(null);
    } finally {
      setPlayLoading(false);
    }
  }, [selected, showToast]);

  const doSearch = useCallback(
    async (kw?: string) => {
      const keyword = (kw ?? query).trim();
      if (keyword === "") return;
      // 取消上一轮未完成的流式搜索。
      searchAbortRef.current?.abort();
      setQuery(keyword);
      recordSearch(keyword);
      setSearching(true);
      setHasSearched(true);
      setSearchError(null);
      setSearchProgress(null);
      setResults([]);
      setView("result");
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        // 流式搜索：SSE 逐批返回，搜到一个源的结果立即上屏，无需等全部渠道。
        const res = await fetch(
          `/api/kazumi/search/stream?q=${encodeURIComponent(keyword)}`,
          { signal: controller.signal },
        );
        if (!res.ok || res.body === null) throw new Error("stream failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // SSE 事件解析收口到纯函数 parseSseEvent（batch/done/error/progress 全覆盖，可单测）。
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { parts, rest } = splitSseChunks(buffer);
          buffer = rest;
          for (const part of parts) {
            const ev = parseSseEvent(part);
            if (ev.type === "batch") {
              setResults((prev) => {
                const seen = new Set(prev.map((i) => `${i.src}:${i.rule}`));
                const fresh = ev.items.filter((i) => !seen.has(`${i.src}:${i.rule}`));
                return [...prev, ...fresh];
              });
            } else if (ev.type === "error") {
              // 验证码/全源失败：明确提示，而不是落入「没有找到」。
              setSearchError(ev.message);
              showToast(ev.message, "error");
            } else if (ev.type === "progress") {
              // 展示「已搜 n/m 源」，让用户知道搜索仍在进行。
              setSearchProgress({ done: ev.done, total: ev.total });
            }
            // done：无动作，循环结束后 setSearching(false) 收尾。
          }
        }
      } catch (error) {
        // 主动取消不提示；网络失败提示。
        if ((error as Error)?.name !== "AbortError") {
          setSearchError("搜索失败（可能被验证码拦截）");
          showToast("搜索失败（可能被验证码拦截）", "error");
        }
      } finally {
        setSearching(false);
        searchAbortRef.current = null;
      }
    },
    [query, showToast],
  );

  const openItem = useCallback(async (item: SearchItem) => {
    setSelected(item);
    setRoads([]);
    setEpisodes([]);
    setRoadIndex(0);
    setLoadingRoads(true);
    try {
      const res = await rpc.api.kazumi.roads.$post({ json: { src: item.src, rule: item.rule } });
      const data = (await res.json()) as { roads?: Road[] };
      setRoads(data.roads ?? []);
    } catch {
      showToast("获取线路失败", "error");
    } finally {
      setLoadingRoads(false);
    }
  }, [showToast]);

  const loadEpisodes = useCallback(async (road: Road) => {
    if (selected === null) return;
    setEpisodes([]);
    try {
      const res = await rpc.api.kazumi.episodes.$post({ json: { src: selected.src, rule: selected.rule, road } });
      const data = (await res.json()) as { episodes?: Episode[] };
      setEpisodes(data.episodes ?? []);
    } catch {
      showToast("获取集数失败", "error");
    }
  }, [selected, showToast]);

  useEffect(() => {
    const road = roads[roadIndex];
    if (road !== undefined) void loadEpisodes(road);
  }, [roads, roadIndex, loadEpisodes]);

  const downloadAllEpisodes = useCallback(async (path: string) => {
    if (batchTarget === null) return;
    const { rule, title, episodes: eps } = batchTarget;
    setBatchDownload({ done: 0, total: eps.length, failed: 0, failedEpisodes: [] });
    setBatchTarget(null);
    showToast(`开始下载整部《${title}》（${eps.length} 集）…`, "info");
    try {
      // SSE 流式下载：每集开始/完成/失败实时推送，前端即时更新进度。
      const res = await fetch("/api/kazumi/download-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rule,
          title,
          episodes: eps.map((ep) => ({ name: ep.name, url: ep.url })),
          ...(path.trim() !== "" ? { path: path.trim() } : {}),
        }),
      });
      if (!res.ok || res.body === null) throw new Error("download-all failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const evLine = part.match(/^event: (\w+)/m)?.[1];
          const dataLine = part.match(/^data: (\{.*\})/ms)?.[1];
          if (evLine === undefined || dataLine === undefined) continue;
          try {
            const data = JSON.parse(dataLine) as {
              index?: number;
              total?: number;
              name?: string;
              filePath?: string;
              error?: string;
              done?: number;
              failed?: number;
              failedEpisodes?: Array<{ name: string; error: string }>;
              message?: string;
            };
            if (evLine === "episode-start") {
              const name = data.name ?? "";
              setBatchDownload((prev) => (prev === null ? null : { ...prev, current: name, total: data.total ?? prev.total }));
            } else if (evLine === "episode-done") {
              // exactOptionalPropertyTypes：不显式赋 undefined，直接展开覆盖。
              setBatchDownload((prev) => {
                if (prev === null) return null;
                const { current: _c, ...rest } = prev;
                return { ...rest, done: prev.done + 1 };
              });
            } else if (evLine === "episode-fail") {
              setBatchDownload((prev) => prev === null ? null : { ...prev, failed: prev.failed + 1, failedEpisodes: [...prev.failedEpisodes, { name: data.name ?? "", error: data.error ?? "" }] });
            } else if (evLine === "done") {
              showToast(
                `整部下载完成：成功 ${data.done ?? 0} 集${(data.failed ?? 0) > 0 ? `，失败 ${data.failed} 集` : ""}`,
                (data.failed ?? 0) > 0 ? "error" : "success",
              );
            } else if (evLine === "error") {
              showToast(`批量下载失败：${data.message ?? "未知错误"}`, "error");
            }
          } catch {
            // 忽略单条解析失败。
          }
        }
      }
    } catch {
      showToast("批量下载失败", "error");
    } finally {
      setBatchDownload(null);
    }
  }, [batchTarget, showToast]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Clapperboard className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold">番剧</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={toggle} title="切换明暗主题">
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setShowDownloadHistory(true)}>
            <Download />下载历史
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="更多选项"
            >
              <MoreHorizontal className="h-5 w-5" />
            </Button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border bg-popover p-1.5 shadow-lg">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setView("rules");
                      setSelected(null);
                      setResults([]);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                    规则管理
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowHelp(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    使用说明
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {view === "rules" ? (
          <RulesView onBack={() => setView("home")} onToast={showToast} />
        ) : selected === null ? (
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-4xl px-4 py-10">
              <h1 className="mb-6 text-2xl font-bold">番剧搜索</h1>
              <div className="relative mb-6 flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
                    blurTimerRef.current = window.setTimeout(() => setSearchFocused(false), 200);
                  }}
                  placeholder="搜索番剧（打全部规则源）…"
                  className="rounded-full"
                  onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
                />
                <Button className="rounded-full" onClick={() => void doSearch()} disabled={searching}>
                  <Search />搜索
                </Button>
                {searchFocused && query.trim() === "" && searchHistory.length > 0 ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-2 w-full rounded-xl border bg-popover p-2 shadow-lg">
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground">搜索历史</span>
                      <button
                        onClick={() => {
                          
                          setSearchHistory([]);
                          try {
                            localStorage.removeItem("kazumi-search-history");
                          } catch {
                            // 忽略。
                          }
                        }}
                        className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                      >
                        清空
                      </button>
                    </div>
                    {searchHistory.map((h) => (
                      <button
                          key={h}
                          onClick={() => void doSearch(h)}
                          onMouseDown={(e) => e.preventDefault()}
                        className="block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <span className="flex items-center gap-2">
                          <History className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="truncate">{h}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {searching && results.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    {searchProgress !== null
                      ? `正在搜索（已查 ${searchProgress.done}/${searchProgress.total} 个源）…`
                      : "正在搜索（逐源返回结果，请稍候）…"}
                  </p>
                  {searchProgress !== null && searchProgress.total > 0 ? (
                    <div className="mx-auto mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.min(100, (searchProgress.done / searchProgress.total) * 100)}%` }}
                      />
                    </div>
                  ) : null}
                  <button
                    onClick={() => searchAbortRef.current?.abort()}
                    className="mt-3 rounded-full border px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    取消搜索
                  </button>
                </div>
              ) : results.length > 0 ? (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      已找到 {results.length} 条结果
                      {searching
                        ? searchProgress !== null
                          ? `，已查 ${searchProgress.done}/${searchProgress.total} 个源…`
                          : "，继续搜索中…"
                        : ""}
                    </p>
                    {searching ? (
                      <button
                        onClick={() => searchAbortRef.current?.abort()}
                        className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        停止
                      </button>
                    ) : null}
                  </div>
                  {searching && searchProgress !== null && searchProgress.total > 0 ? (
                    <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.min(100, (searchProgress.done / searchProgress.total) * 100)}%` }}
                      />
                    </div>
                  ) : null}
                  <ul className="divide-y divide-border/60 rounded-2xl border bg-card">
                    {[...results]
                      // 按源排名排序：有排名分的源排前（分数降序），无排名的保持相对顺序。
                      .sort((a, b) => {
                        const sa = ruleRankings.get(a.rule)?.score ?? -1;
                        const sb = ruleRankings.get(b.rule)?.score ?? -1;
                        return sb - sa;
                      })
                      .map((it, i) => {
                        const rank = ruleRankings.get(it.rule);
                        return (
                          <li key={`${it.src}-${it.rule}-${i}`}>
                            <button onClick={() => void openItem(it)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted">
                              <Play className="h-4 w-4 shrink-0 text-primary" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{it.name}</p>
                                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                  源：{it.rule}
                                  {rank !== undefined ? (
                                    <span className="ml-1 flex shrink-0 items-center gap-1">
                                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{rank.score}分</span>
                                      {rank.avgBandwidth > 0 ? (
                                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{formatBitrate(rank.avgBandwidth)}</span>
                                      ) : null}
                                      {rank.downloadSuccessRate > 0 ? (
                                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">下载{Math.round(rank.downloadSuccessRate * 100)}%</span>
                                      ) : null}
                                    </span>
                                  ) : null}
                                </p>
                              </div>
                              <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </>
              ) : searchError !== null ? (
                <EmptyState
                  icon={<RefreshCw className="h-6 w-6" />}
                  title="搜索失败"
                  description={searchError}
                  actionLabel="重试"
                  onAction={() => void doSearch(query)}
                />
              ) : hasSearched ? (
                <EmptyState
                  icon={<Search className="h-6 w-6" />}
                  title={`没有找到「${query.trim()}」`}
                  description="换个关键词试试，或点击下方热门番剧直接开始"
                />
              ) : (
                <div className="space-y-8">
                  <div>
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">🔥 热门番剧</h2>
                    <div className="flex flex-wrap gap-2">
                      {HOT_ANIME.map((k) => (
                        <button
                          key={k}
                          onClick={() => void doSearch(k)}
                          className="rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">分类</h2>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map((k) => (
                        <button
                          key={k}
                          onClick={() => void doSearch(k)}
                          className="rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-4xl px-4 py-6">
              <button onClick={() => setSelected(null)} className="mb-4 flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />返回搜索
              </button>
              <h1 className="mb-4 text-xl font-bold">{selected.name}</h1>
              <p className="mb-4 text-xs text-muted-foreground">源：{selected.rule}</p>

              {loadingRoads ? (
                <p className="py-10 text-center text-sm text-muted-foreground">加载线路中…</p>
              ) : roads.length === 0 ? (
                <EmptyState icon={<ListChecks className="h-6 w-6" />} title="无可用线路" description="该视频源暂时没有可用线路，试试其他搜索结果" />
              ) : (
                <>
                  {/* 线路选择（清晰度高的排前，来自服务端排序） */}
                  <div className="mb-4 flex flex-wrap gap-2">
                    {roads.map((r, i) => (
                      <button
                        key={`${r.name}-${i}`}
                        onClick={() => setRoadIndex(i)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                          roadIndex === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                      >
                        {r.name || `线路${i + 1}`}
                        {(r.quality !== undefined && (r.quality.resolution !== undefined || r.quality.bandwidth !== undefined)) || qualityBadge(r.name) !== null ? (
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] leading-none", roadIndex === i ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary")}>
                            {r.quality !== undefined && (r.quality.resolution !== undefined || r.quality.bandwidth !== undefined)
                              ? [r.quality.resolution, r.quality.bandwidth !== undefined ? formatBitrate(r.quality.bandwidth) : null].filter(Boolean).join(" · ")
                              : qualityBadge(r.name)}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  {/* 批量下载工具条 */}
                  {episodes.length > 0 ? (
                    <div className="mb-4 flex items-center justify-between rounded-2xl border bg-card px-4 py-3">
                      <div className="flex items-center gap-2">
                        <HardDriveDownload className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">共 {episodes.length} 集</span>
                        {batchDownload !== null ? (
                          <span className="text-xs text-muted-foreground">
                            {batchDownload.current !== undefined ? (
                              <>
                                正在下载 <span className="text-primary">{batchDownload.current}</span> ·{" "}
                              </>
                            ) : null}
                            已完成 {batchDownload.done}/{batchDownload.total}
                            {batchDownload.failed > 0 ? `，失败 ${batchDownload.failed}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        className="rounded-full"
                        disabled={batchDownload !== null}
                        onClick={() => {
                          if (selected === null || episodes.length === 0) return;
                          setBatchTarget({
                            rule: selected.rule,
                            title: selected.name.replace(/^\[[^\]]+\]\s*/, "").slice(0, 60),
                            episodes: [...episodes],
                          });
                        }}
                      >
                        <Download />
                        {batchDownload !== null ? "下载中…" : "下载全部"}
                      </Button>
                    </div>
                  ) : null}
                  {batchDownload !== null ? (
                    <div className="mb-4">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${batchDownload.total > 0 ? (batchDownload.done / batchDownload.total) * 100 : 0}%` }}
                        />
                      </div>
                      {batchDownload.failedEpisodes.length > 0 ? (
                        <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border bg-card p-2">
                          {batchDownload.failedEpisodes.map((f, i) => (
                            <p key={i} className="truncate text-[11px] text-destructive">
                              ✗ {f.name}：{f.error.slice(0, 60)}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 集数列表 */}
                  <ul className="divide-y divide-border/60 rounded-2xl border bg-card">
                    {episodes.map((ep, i) => (
                      <li key={`${ep.url}-${i}`} className="flex items-center gap-3 px-4 py-3">
                        <button onClick={() => void playEpisode(ep)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-medium">{ep.name}</p>
                        </button>
                        <button
                          onClick={() => void playEpisode(ep)}
                          className="shrink-0 rounded-full p-2 text-primary transition-colors hover:text-foreground"
                          title="播放"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDownloadTarget(ep)}
                          disabled={downloading === ep.url}
                          className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
                          title="下载"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                    {episodes.length === 0 ? <li><EmptyState icon={<Play className="h-6 w-6" />} title="暂无集数" description="该线路暂未解析出剧集" /></li> : null}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {downloadTarget !== null && selected !== null ? (
        <KazumiDownloadDialog
          episode={downloadTarget}
          rule={selected.rule}
          onDownload={async (path) => {
            try {
              setDownloading(downloadTarget.url);
              showToast("开始下载到 NAS…", "info");
              const res = await rpc.api.kazumi.download.$post({
                json: { rule: selected.rule, name: downloadTarget.name, url: downloadTarget.url, ...(path.trim() !== "" ? { path: path.trim() } : {}) },
              });
              const data = (await res.json()) as { filePath?: string; error?: string };
              if (data.error !== undefined) {
                // 加密源（JS 动态取流/VodX 密文）无法静态解析，给出可操作提示。
                showToast(
                  data.error.includes("m3u8") || data.error.includes("解析")
                    ? `下载失败：该源加密无法自动下载（${data.error}）`
                    : `下载失败 ${data.error}`,
                  "error",
                );
              } else showToast("已下载到 NAS", "success");
            } catch {
              showToast("下载失败", "error");
            } finally {
              setDownloading(null);
            }
          }}
          onClose={() => setDownloadTarget(null)}
        />
      ) : null}

      {batchTarget !== null ? (
        <KazumiDownloadDialog
          rule={batchTarget.rule}
          title={batchTarget.title}
          batchCount={batchTarget.episodes.length}
          onDownload={(path) => void downloadAllEpisodes(path)}
          onClose={() => setBatchTarget(null)}
        />
      ) : null}

      {showDownloadHistory ? <DownloadHistoryPanel onClose={() => setShowDownloadHistory(false)} platform="kazumi" /> : null}

      {showHelp ? <KazumiHelp onClose={() => setShowHelp(false)} /> : null}

      {playingEpisode !== null ? (
        <KazumiPlayer
          episode={playingEpisode}
          m3u8Url={m3u8Url}
          loading={playLoading}
          error={playError}
          quality={streamQuality}
          active={active}
          onClose={() => { setPlayingEpisode(null); setM3u8Url(null); setPlayError(null); setStreamQuality(null); }}
          onPlayManual={(url) => {
            // 用户手动填写的 m3u8 直链：直接经 playlist 代理播放。
            setM3u8Url(`/api/kazumi/playlist?url=${encodeURIComponent(url)}&rule=${encodeURIComponent(selected?.rule ?? "")}`);
          }}
        />
      ) : null}
    </div>
  );
}

/** 番剧模块使用说明（首次引导 + 随时可查）。 */
function KazumiHelp(props: { onClose: () => void }) {
  const { onClose } = props;
  useEscToClose(onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md animate-fade-in rounded-2xl bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">番剧使用说明</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">搜索番剧</span>：在搜索框输入番剧名，会同时查询全部已配置的视频源（约 20 秒）。</p>
          </div>
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">选择线路与集数</span>：每个结果可能有多个「线路」（不同片源），切换线路后选择要看的集数。</p>
          </div>
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">3</span>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">播放与下载</span>：点集数直接在线播放；下载会保存到 NAS 的下载目录。</p>
          </div>
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">4</span>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">规则管理</span>：番剧内容来自「规则」文件（在右上角更多菜单里），通常已预装 85 个常用源，无需手动配置。</p>
          </div>
        </div>
        <Button size="sm" className="mt-5 w-full rounded-full" onClick={onClose}>
          知道了
        </Button>
      </div>
    </div>
  );
}

/** 番剧在线播放器（hls.js 播放代理 m3u8）。 */
function KazumiPlayer(props: {
  episode: Episode;
  m3u8Url: string | null;
  loading: boolean;
  error: string | null;
  quality?: { bandwidth?: number; resolution?: string } | null;
  active?: boolean;
  onClose: () => void;
  onPlayManual: (url: string) => void;
}) {
  const { episode, m3u8Url, loading, error, quality, active = true, onClose, onPlayManual } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manualUrl, setManualUrl] = useState("");

  // 模块失活时暂停播放，避免切走后仍在后台出声。
  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null || m3u8Url === null) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(m3u8Url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = m3u8Url;
    }
  }, [m3u8Url]);

  // 双击进入/退出全屏（单击交给原生 controls，避免双重触发）。
  const handleVideoDoubleClick = () => {
    const el = videoRef.current;
    if (el === null) return;
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen().catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between text-white">
          <p className="truncate text-sm font-medium">{episode.name}</p>
          <div className="flex items-center gap-2">
            {quality !== undefined && quality !== null && (quality.resolution !== undefined || quality.bandwidth !== undefined) ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80">
                {[quality.resolution, quality.bandwidth !== undefined ? formatBitrate(quality.bandwidth) : null].filter(Boolean).join(" · ")}
              </span>
            ) : null}
            <button onClick={onClose} className="rounded-full p-2 transition-colors hover:bg-white/10" aria-label="关闭播放器">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          {loading ? (
            <div className="flex h-full w-full items-center justify-center text-sm text-white/70">解析播放地址中…</div>
          ) : error !== null && m3u8Url === null ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-white/80">{error}</p>
              <p className="text-xs text-white/50">该源可能使用 JS 动态取流或加密播放，自动解析失败</p>
              <div className="flex w-full max-w-md gap-2">
                <Input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="粘贴 m3u8 直链（浏览器抓包获取）"
                  className="rounded-full bg-white/10 text-white placeholder:text-white/40"
                  onKeyDown={(e) => { if (e.key === "Enter" && manualUrl.trim() !== "") onPlayManual(manualUrl.trim()); }}
                />
                <Button
                  className="shrink-0 rounded-full"
                  onClick={() => { if (manualUrl.trim() !== "") onPlayManual(manualUrl.trim()); }}
                >
                  播放
                </Button>
              </div>
            </div>
          ) : (
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              onDoubleClick={handleVideoDoubleClick}
              className="h-full w-full"
            />
          )}
        </div>
        <p className="mt-2 text-center text-xs text-white/50">双击全屏/退出全屏</p>
      </div>
    </div>
  );
}

// ---------- 规则管理 ----------

function RulesView(props: { onBack: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { onBack, onToast } = props;
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingRule, setRemovingRule] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await rpc.api.kazumi.rules.$get();
      const data = (await res.json()) as { rules?: string[] };
      setRules((data.rules ?? []).map((name) => ({ name })));
    } catch {
      onToast("读取规则失败", "error");
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load]);

  const addRule = async () => {
    let json: unknown;
    try {
      json = JSON.parse(jsonText);
    } catch {
      onToast("JSON 解析失败", "error");
      return;
    }
    try {
      const res = await rpc.api.kazumi.rules.add.$post({ json: { json } });
      const data = (await res.json()) as { ok?: boolean; name?: string; error?: string };
      if (data.error !== undefined) onToast(`添加失败：${data.error}`, "error");
      else {
        onToast(`已添加规则 ${data.name ?? ""}`, "success");
        setJsonText("");
        setAdding(false);
        await load();
      }
    } catch {
      onToast("添加失败", "error");
    }
  };

  const removeRule = async (name: string) => {
    try {
      await rpc.api.kazumi.rules.remove.$post({ json: { name } });
      onToast("已删除", "success");
      await load();
    } catch {
      onToast("删除失败", "error");
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />返回
          </button>
          <h1 className="text-lg font-bold">规则管理（{rules.length}）</h1>
          <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-primary hover:bg-muted">
            <FilePlus2 className="h-4 w-4" />添加规则
          </button>
        </div>

        {adding ? (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">添加规则</CardTitle>
              <CardDescription>粘贴 Kazumi 规则 JSON（会校验合法性）</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder='{"api":"1","name":"站点名",...}'
                className="h-48 w-full rounded-lg border bg-background p-3 font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="flex-1 rounded-full" onClick={() => setAdding(false)}>取消</Button>
                <Button size="sm" className="flex-1 rounded-full" onClick={() => void addRule()}>添加</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* 源质量动态排名（来自历史搜索/探测统计） */}
        <RuleRankingsPanel onToast={onToast} />

        <ul className="divide-y divide-border/60 rounded-2xl border bg-card">
          {rules.map((r) => (
            <li key={r.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
              </div>
              <button onClick={() => setRemovingRule(r.name)} className="shrink-0 rounded-full p-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {rules.length === 0 ? <li><EmptyState icon={<ListChecks className="h-6 w-6" />} title="暂无规则" description="点击右上角「添加规则」粘贴 Kazumi 规则 JSON 开始使用" /></li> : null}
        </ul>
        {removingRule !== null ? (
          <ConfirmDialog
            title="删除规则"
            description={`确定删除规则「${removingRule}」？删除后该番剧源将无法使用。`}
            confirmLabel="删除"
            destructive
            onConfirm={() => void removeRule(removingRule)}
            onClose={() => setRemovingRule(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 源质量动态排名（来自历史搜索/线路探测统计，数据库持久化）。 */
function RuleRankingsPanel(props: { onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { onToast } = props;
  const [rankings, setRankings] = useState<Array<{
    rule: string;
    searches: number;
    successes: number;
    successRate: number;
    avgLatencyMs: number;
    avgBandwidth: number;
    downloads: number;
    downloadSuccessRate: number;
    avgSpeed: number;
    score: number;
  }>>([]);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await rpc.api.kazumi["rule-rankings"].$get();
      const data = (await res.json()) as { rankings?: typeof rankings };
      setRankings(data.rankings ?? []);
    } catch {
      onToast("读取源排名失败", "error");
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load]);

  const fmtBitrate = (bps: number): string =>
    bps > 0 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : "—";
  const fmtPct = (rate: number): string => `${Math.round(rate * 100)}%`;
  const fmtLatency = (ms: number): string => (ms > 0 ? `${ms}ms` : "—");

  return (
    <Card className="mb-4">
      <CardHeader className="cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" />
          源质量排名
          <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
            按搜索 · 下载成功率 · 码率 · 速率综合排序
            <ChevronLeft className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : "-rotate-90"}`} />
          </span>
        </CardTitle>
        {!expanded && rankings.length > 0 ? (
          <CardDescription>
            Top {Math.min(3, rankings.length)}：{rankings.slice(0, 3).map((r) => `${r.rule}(${r.score})`).join(" · ")}
          </CardDescription>
        ) : null}
      </CardHeader>
      {expanded ? (
        <CardContent>
          {rankings.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              暂无排名数据——搜索过番剧、下载过或探测过线路后，这里会显示各源的质量分
            </p>
          ) : (
            <ol className="space-y-1">
              {rankings.map((r, i) => (
                <li key={r.rule} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-muted">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${i < 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.rule}</span>
                  <span className="hidden text-muted-foreground sm:block">
                    搜索 {fmtPct(r.successRate)} · 下载 {r.downloads > 0 ? fmtPct(r.downloadSuccessRate) : "—"} · 码率 {fmtBitrate(r.avgBandwidth)}
                    {r.downloads > 0 ? ` · 速率 ${fmtBitrate(r.avgSpeed)}` : ""}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{r.score} 分</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

// ---------- 下载对话框 ----------

function KazumiDownloadDialog(props: {
  episode?: Episode;
  rule: string;
  /** 整部下载时传：显示「N 集」并确认整部下载。 */
  batchCount?: number;
  title?: string;
  onDownload: (path: string) => void;
  onClose: () => void;
}) {
  const { episode, rule, batchCount, title, onDownload, onClose } = props;
  const [path, setPath] = useState("");
  useEscToClose(onClose);
  const [dirs, setDirs] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const loadDirs = useCallback(async (p: string) => {
    try {
      const res = await rpc.api["download-dirs"].$get({ query: { path: p } });
      const data = (await res.json()) as { dirs?: string[] };
      setDirs(data.dirs ?? []);
    } catch {
      // 忽略。
    }
  }, []);
  useEffect(() => { void loadDirs(path); }, [path, loadDirs]);
  const createFolder = async () => {
    if (newName.trim() === "") return;
    try {
      await rpc.api["download-mkdir"].$post({ json: { path, name: newName.trim() } });
      setNewName("");
      setCreating(false);
      await loadDirs(path);
    } catch {
      // 忽略。
    }
  };
  const isBatch = batchCount !== undefined && batchCount > 0;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">{isBatch ? "整部下载到 NAS" : "下载到 NAS"}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 truncate text-sm text-muted-foreground">
          {isBatch ? `${title ?? ""} · ${batchCount} 集 · ${rule}` : `${episode?.name ?? ""} · ${rule}`}
        </p>
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
          <button onClick={() => setPath(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")} className="rounded-full p-1 text-muted-foreground hover:text-foreground" disabled={path === ""}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">/{path || "根目录"}</span>
        </div>
        <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border">
          {dirs.map((d) => (
            <button key={d} onClick={() => setPath(path === "" ? d : `${path}/${d}`)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
              <Folder className="h-4 w-4 text-muted-foreground" />{d}
            </button>
          ))}
          {dirs.length === 0 ? <p className="px-3 py-4 text-center text-xs text-muted-foreground">空文件夹</p> : null}
        </div>
        {creating ? (
          <div className="mb-3 flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="文件夹名" className="rounded-full text-xs" autoFocus />
            <Button size="sm" className="shrink-0 rounded-full" onClick={() => void createFolder()}>创建</Button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="mb-3 flex items-center gap-1.5 text-sm font-medium text-primary">
            <FolderPlus className="h-4 w-4" />新建文件夹
          </button>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1 rounded-full" onClick={onClose}>取消</Button>
          <Button size="sm" className="flex-1 rounded-full" onClick={() => { onDownload(path); onClose(); }}>
            <Download />{isBatch ? "下载全部" : "下载"}
          </Button>
        </div>
      </div>
    </div>
  );
}
