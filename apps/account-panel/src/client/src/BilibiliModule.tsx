import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  Clock,
  Download,
  Flame,
  Folder,
  FolderPlus,
  History,
  Heart,
  ListVideo,
  LogOut,
  Maximize,
  MessageSquare,
  Minimize,
  Moon,
  Pause,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { rpc } from "./lib/rpc";
import DownloadHistoryPanel from "./DownloadHistoryPanel";
import { DanmakuOverlay, type DanmakuItem } from "./DanmakuOverlay";
import { cn } from "@/lib/utils";
import { useTheme } from "./lib/use-theme";
import { useToast } from "@/components/ui/toast";
import { useEscToClose } from "@/lib/use-esc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";

// ---------- 类型 ----------

interface BiliAccount {
  loggedIn: boolean;
  error?: string;
  account?: {
    mid: number;
    nickname: string;
    avatarUrl?: string;
    signature?: string;
    fans: number;
    following: number;
    level: number;
    vip: boolean;
  };
}

interface BiliVideo {
  bvid: string;
  aid: number;
  title: string;
  cover?: string;
  duration?: number;
  play?: number;
  danmaku?: number;
  author?: string;
  mid?: number;
}

interface BiliVideoDetail extends BiliVideo {
  cid?: number;
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
}

interface LoginView {
  sessionId: string;
  qrDataUrl?: string;
  state: string;
  message: string;
}

interface StreamInfo {
  quality: number;
  dash: boolean;
  videoUrl: string;
  audioUrl?: string;
  durationMs?: number;
  title: string;
}

interface HistoryEntry {
  kid: number;
  title: string;
  business: string;
  viewAt: number;
  progress?: number;
  duration?: number;
  author?: string;
  cover?: string;
}

interface FavFolderItem {
  id: number;
  fid: number;
  title: string;
  mediaCount: number;
  cover?: string;
}

function fmtDuration(sec?: number): string {
  if (sec === undefined || sec <= 0) return "--:--";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtCount(n?: number): string {
  if (n === undefined) return "";
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function coverGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 70) % 360;
  return `linear-gradient(135deg, hsl(${h1} 75% 45%), hsl(${h2} 75% 35%))`;
}

// ---------- 主组件 ----------

export default function BilibiliModule({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const { theme, toggle } = useTheme();
  const [account, setAccount] = useState<BiliAccount | null>(null);
  const [login, setLogin] = useState<LoginView | null>(null);
  const [view, setView] = useState<"home" | "history" | "watchLater" | "fav" | "bangumi" | "popular">("home");
  // 「发现」视图内的子 tab：推荐流 / 综合热门 / 排行榜 / 每周必看。
  const [exploreTab, setExploreTab] = useState<"recommend" | "popular" | "ranking" | "weekly" | "live" | "liked">("popular");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BiliVideo[]>([]);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<BiliVideoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<BiliVideoDetail | null>(null);
  const [showDownloadHistory, setShowDownloadHistory] = useState(false);
  const loginEsRef = useRef<EventSource | null>(null);
  // 由 VideoDetailView 注册的暂停回调：模块失活时暂停正在播放的视频/音频。
  const pausePlaybackRef = useRef<(() => void) | null>(null);

  // 模块失活（切到其他模块）时暂停 B站播放，避免后台出声。
  useEffect(() => {
    if (!active) pausePlaybackRef.current?.();
  }, [active]);

  const toastApi = useToast();
  const showToast = useCallback(
    (message: string, type?: "success" | "error" | "info") => {
      toastApi.show(message, type);
    },
    [toastApi],
  );

  const refreshAccount = useCallback(async () => {
    try {
      const res = await rpc.api.bilibili.account.$get();
      setAccount((await res.json()) as BiliAccount);
    } catch {
      // 后端不可达：标记错误（绑定页展示「连接失败」而非误导为未登录）。
      setAccount({ loggedIn: false, error: "无法连接后端服务，请检查服务是否已启动" });
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  useEffect(() => {
    return () => loginEsRef.current?.close();
  }, []);

  const startLogin = useCallback(async () => {
    try {
      const res = await rpc.api.auth.start.$post({ json: { platform: "bilibili" } });
      const { sessionId } = (await res.json()) as { sessionId: string };
      setLogin({ sessionId, state: "waiting", message: "正在生成二维码…" });
      loginEsRef.current?.close();
      loginEsRef.current = null;
      const es = new EventSource(`/api/auth/stream?id=${encodeURIComponent(sessionId)}`);
      loginEsRef.current = es;
      es.addEventListener("qr", (e) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { qrDataUrl: string };
        setLogin((prev) => (prev ? { ...prev, qrDataUrl: data.qrDataUrl } : prev));
      });
      es.addEventListener("status", (e) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { state: string; message: string };
        setLogin((prev) => (prev ? { ...prev, state: data.state, message: data.message } : prev));
        if (data.state === "success" || data.state === "failed" || data.state === "timeout") {
          es.close();
          loginEsRef.current = null;
          if (data.state === "success") {
            setLogin(null);
            void refreshAccount();
          }
        }
      });
      es.onerror = () => {
        es.close();
        loginEsRef.current = null;
        setLogin((prev) => (prev ? { ...prev, message: "连接中断，请重试" } : prev));
      };
    } catch {
      showToast("发起登录失败");
    }
  }, [refreshAccount, showToast]);

  const doSearch = useCallback(async () => {
    if (query.trim() === "") return;
    setSearching(true);
    try {
      const res = await rpc.api.bilibili.search.$get({ query: { q: query.trim() } });
      const data = (await res.json()) as { videos?: BiliVideo[] };
      setResults(data.videos ?? []);
    } catch {
      showToast("搜索失败", "error");
    } finally {
      setSearching(false);
    }
  }, [query, showToast]);

  const openDetail = useCallback(async (bvid: string) => {
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await rpc.api.bilibili.video.$get({ query: { bvid } });
      const data = (await res.json()) as { video?: BiliVideoDetail; parts?: BiliVideoDetail[] };
      if (data.video !== undefined) {
        setDetail({
          ...data.video,
          ...(data.parts !== undefined && data.parts.length > 0
            ? { pages: data.parts.map((p, i) => ({ cid: p.cid ?? 0, page: i + 1, part: p.title, duration: p.duration ?? 0 })) }
            : {}),
        });
      }
    } catch {
      showToast("获取视频失败", "error");
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  const logout = useCallback(async () => {
    try {
      await rpc.api.bilibili.logout.$post();
      showToast("已退出登录", "success");
      await refreshAccount();
    } catch {
      showToast("退出失败", "error");
    }
  }, [refreshAccount, showToast]);

  // ---------- 未登录：绑定页 ----------
  if (account !== null && !account.loggedIn) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />首页
          </button>
          <span className="text-base font-semibold">哔哩哔哩</span>
        </header>
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-sm border-0 bg-card/70 shadow-lg backdrop-blur-xl">
            <CardHeader className="items-center text-center">
              <CardTitle>{account?.error !== undefined ? "连接失败" : "绑定哔哩哔哩"}</CardTitle>
              <CardDescription>
                {account?.error !== undefined
                  ? "无法连接后端服务，请检查服务是否已启动"
                  : "扫码登录 B 站，登录态同步到统一账号"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              {account?.error !== undefined ? (
                <>
                  <p className="text-sm text-destructive">{account.error}</p>
                  <Button size="lg" className="rounded-full" onClick={() => void refreshAccount()}>
                    <RefreshCw />
                    重新连接
                  </Button>
                </>
              ) : login === null ? (
                <Button size="lg" className="rounded-full" onClick={() => void startLogin()}>
                  <QrCode />扫码绑定 B 站
                </Button>
              ) : (
                <>
                  {login.qrDataUrl ? (
                    <img src={login.qrDataUrl} alt="登录二维码" className="h-56 w-56 max-w-full rounded-2xl bg-white p-2 shadow-sm" />
                  ) : (
                    <div className="flex h-56 w-56 items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">二维码加载中…</div>
                  )}
                  <p className="text-sm text-muted-foreground">{login.message}</p>
                  <Button variant="ghost" size="sm" className="rounded-full" onClick={() => { loginEsRef.current?.close(); setLogin(null); }}>
                    取消
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="rounded-full" onClick={onBack}>返回首页</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ---------- 已登录：主界面 ----------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ListVideo className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold">哔哩哔哩</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={toggle} title="切换明暗主题">
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void refreshAccount()}>
            <RefreshCw />刷新
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setShowDownloadHistory(true)}>
            <Download />下载历史
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void logout()}>
            <LogOut />退出
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {detailLoading ? (
          <Skeleton />
        ) : detail !== null ? (
          <VideoDetailView
            detail={detail}
            onBack={() => setDetail(null)}
            onToast={showToast}
            onDownload={() => setDownloadTarget(detail)}
            registerPause={(fn) => {
              pausePlaybackRef.current = fn;
            }}
          />
        ) : view === "history" ? (
          <HistoryView onBack={() => setView("home")} onToast={showToast} />
        ) : view === "watchLater" ? (
          <WatchLaterView onBack={() => setView("home")} onToast={showToast} />
        ) : view === "fav" ? (
          <FavView onBack={() => setView("home")} onToast={showToast} onOpenVideo={(bvid) => void openDetail(bvid)} />
        ) : view === "bangumi" ? (
          <BangumiView onBack={() => setView("home")} onToast={showToast} />
        ) : view === "popular" ? (
          <DiscoverView
            tab={exploreTab}
            onTabChange={setExploreTab}
            onBack={() => setView("home")}
            onToast={showToast}
            onOpenVideo={(bvid) => void openDetail(bvid)}
          />
        ) : (
          <HomeView
            account={account}
            query={query}
            setQuery={setQuery}
            searching={searching}
            results={results}
            onSearch={() => void doSearch()}
            onOpenVideo={(bvid) => void openDetail(bvid)}
            onOpenHistory={() => setView("history")}
            onOpenWatchLater={() => setView("watchLater")}
            onOpenFav={() => setView("fav")}
            onOpenBangumi={() => setView("bangumi")}
            onOpenPopular={() => { setExploreTab("popular"); setView("popular"); }}
            onOpenRecommend={() => { setExploreTab("recommend"); setView("popular"); }}
          />
        )}
      </div>

      {downloadTarget !== null ? (
        <DownloadDialog
          video={downloadTarget}
          onDownload={(path) => void downloadToNas(downloadTarget, path, showToast)}
          onClose={() => setDownloadTarget(null)}
        />
      ) : null}

      {showDownloadHistory ? <DownloadHistoryPanel onClose={() => setShowDownloadHistory(false)} platform="bilibili" /> : null}
    </div>
  );
}

/** 下载到 NAS。 */
async function downloadToNas(
  video: BiliVideoDetail,
  path: string,
  toast: (m: string, type?: "success" | "error" | "info") => void,
): Promise<void> {
  // 先给即时反馈：大文件下载需要较长时间，不能让用户以为没点中。
  toast("开始下载到 NAS…", "info");
  try {
    const res = await rpc.api.bilibili.download.$post({
      json: { bvid: video.bvid, ...(video.cid !== undefined ? { cid: video.cid } : {}), ...(path.trim() !== "" ? { path: path.trim() } : {}) },
    });
    const data = (await res.json()) as { filePath?: string; error?: string };
    if (data.error !== undefined) toast(`下载失败 ${data.error}`, "error");
    else toast("已下载到 NAS", "success");
  } catch {
    toast("下载失败", "error");
  }
}

// ---------- 子视图 ----------

function HomeView(props: {
  account: BiliAccount | null;
  query: string;
  setQuery: (q: string) => void;
  searching: boolean;
  results: BiliVideo[];
  onSearch: () => void;
  onOpenVideo: (bvid: string) => void;
  onOpenHistory: () => void;
  onOpenWatchLater: () => void;
  onOpenFav: () => void;
  onOpenBangumi: () => void;
  onOpenPopular: () => void;
  onOpenRecommend: () => void;
}) {
  const { account, query, setQuery, searching, results, onSearch, onOpenVideo, onOpenHistory, onOpenWatchLater, onOpenFav, onOpenBangumi, onOpenPopular, onOpenRecommend } = props;
  const info = account?.account;
  const [avatarError, setAvatarError] = useState(false);
  // 搜索历史（localStorage 持久化，最多 10 条）。
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("bili-search-history");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimerRef = useRef<number | null>(null);

  const submitSearch = (kw: string) => {
    const q = kw.trim();
    if (q === "") return;
    setQuery(q);
    setSearchHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, 10);
      try {
        localStorage.setItem("bili-search-history", JSON.stringify(next));
      } catch {
        // 忽略。
      }
      return next;
    });
    onSearch();
  };

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-8 flex items-center gap-4">
          <Avatar className="h-16 w-16" onError={() => setAvatarError(true)}>
            {info?.avatarUrl && !avatarError ? <AvatarImage src={info.avatarUrl} /> : null}
            <AvatarFallback>{info?.nickname?.slice(0, 2) ?? "B"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold">{info?.nickname ?? "B站用户"}</h1>
              <Badge variant="secondary">Lv{info?.level ?? 0}</Badge>
              {info?.vip ? <Badge>大会员</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              粉丝 {fmtCount(info?.fans)} · 关注 {fmtCount(info?.following)}
            </p>
            {info?.signature ? <p className="mt-1 truncate text-xs text-muted-foreground">{info.signature}</p> : null}
          </div>
        </div>

        <div className="relative mb-6 flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => {
              if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
              blurTimerRef.current = window.setTimeout(() => setSearchFocused(false), 200);
            }}
            placeholder="搜索 B 站视频…"
            className="rounded-full"
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(query); }}
          />
          <Button className="rounded-full" onClick={() => submitSearch(query)} disabled={searching}>
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
                      localStorage.removeItem("bili-search-history");
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
                          onClick={() => submitSearch(h)}
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

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <EntryButton icon={<Sparkles />} label="推荐" onClick={onOpenRecommend} />
          <EntryButton icon={<Flame />} label="热门" onClick={onOpenPopular} />
          <EntryButton icon={<History />} label="历史记录" onClick={onOpenHistory} />
          <EntryButton icon={<Clock />} label="稍后再看" onClick={onOpenWatchLater} />
          <EntryButton icon={<Folder />} label="收藏夹" onClick={onOpenFav} />
          <EntryButton icon={<Star />} label="追番" onClick={onOpenBangumi} />
        </div>

        {results.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-muted-foreground">共 {results.length} 条结果</p>
            <VideoGrid videos={results} onOpen={onOpenVideo} />
          </>
        ) : searching ? (
          <p className="py-16 text-center text-sm text-muted-foreground">搜索中…</p>
        ) : (
          <EmptyState icon={<Search className="h-6 w-6" />} title="搜索 B 站视频" description="输入关键词，搜索全站投稿、番剧与影视内容" />
        )}
      </div>
    </div>
  );
}

function EntryButton(props: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">{props.icon}</span>
      {props.label}
    </button>
  );
}

function VideoGrid(props: { videos: BiliVideo[]; onOpen: (bvid: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {props.videos.map((v) => (
        <button key={v.bvid} onClick={() => props.onOpen(v.bvid)} className="group text-left">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
            {v.cover ? (
              <img src={v.cover} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center" style={{ background: coverGradient(v.title) }}>
                <ListVideo className="h-6 w-6 text-white/70" />
              </div>
            )}
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-xs text-white">{fmtDuration(v.duration)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-medium">{v.title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {v.author}
            {v.play !== undefined ? <span>· {fmtCount(v.play)}播放</span> : null}
          </p>
        </button>
      ))}
    </div>
  );
}

/** 视频详情 + 自包含播放器（可见 video + 分离音频同步）。 */
function VideoDetailView(props: {
  detail: BiliVideoDetail;
  onBack: () => void;
  onToast: (m: string, type?: "success" | "error" | "info") => void;
  onDownload: () => void;
  registerPause?: (fn: () => void) => void;
}) {
  const { detail, onBack, onToast, onDownload, registerPause } = props;
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedCid, setSelectedCid] = useState<number | undefined>(detail.cid);
  const [showFavAdd, setShowFavAdd] = useState(false);
  const [danmakuItems, setDanmakuItems] = useState<DanmakuItem[]>([]);
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [danmakuLoading, setDanmakuLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const pages = detail.pages ?? [];

  // 向模块注册「暂停播放」回调：切走模块时由父组件调用，避免后台出声。
  useEffect(() => {
    if (registerPause === undefined) return;
    registerPause(() => {
      videoRef.current?.pause();
      audioRef.current?.pause();
    });
    return () => {
      registerPause(() => {});
    };
  }, [registerPause]);

  // 按 cid 分段拉取弹幕（每段 6 分钟，最多 20 段覆盖 2 小时）。
  const loadDanmaku = useCallback(
    async (cid: number) => {
      setDanmakuItems([]);
      setDanmakuLoading(true);
      try {
        const all: DanmakuItem[] = [];
        for (let segment = 0; segment < 20; segment += 1) {
          const res = await rpc.api.bilibili.danmaku.$get({
            query: { cid: String(cid), segment: String(segment) },
          });
          const data = (await res.json()) as { items?: DanmakuItem[] };
          const batch = data.items ?? [];
          if (batch.length === 0) break;
          all.push(...batch);
        }
        setDanmakuItems(all.sort((a, b) => a.time - b.time));
      } catch {
        // 弹幕加载失败不阻塞播放，静默降级。
      } finally {
        setDanmakuLoading(false);
      }
    },
    [],
  );

  const play = useCallback(
    async (cid?: number) => {
      setStream(null);
      setStreamLoading(true);
      try {
        const res = await rpc.api.bilibili.stream.$get({
          query: { bvid: detail.bvid, ...(cid !== undefined ? { cid: String(cid) } : {}) },
        });
        const data = (await res.json()) as StreamInfo;
        setStream(data);
        setCurrentTime(0);
        setDuration((data.durationMs ?? 0) / 1000);
        // 播放的同时拉取对应分P弹幕。
        const targetCid = cid ?? detail.cid;
        if (targetCid !== undefined) void loadDanmaku(targetCid);
      } catch {
        onToast("取流失败", "error");
      } finally {
        setStreamLoading(false);
      }
    },
    [detail.bvid, detail.cid, loadDanmaku, onToast],
  );

  // 视频/音频元素就绪后同步播放。
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (stream === null || video === null) return;
    video.src = stream.videoUrl;
    if (audio !== null && stream.audioUrl !== undefined) audio.src = stream.audioUrl;
    video.volume = muted ? 0 : 1;
    if (audio !== null) audio.volume = muted ? 0 : 1;
    void video.play().catch(() => {});
    if (audio !== null && stream.audioUrl !== undefined) void audio.play().catch(() => {});
  }, [stream, muted]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video === null) return;
    if (playing) {
      video.pause();
      audio?.pause();
    } else {
      void video.play();
      if (audio !== null && stream?.audioUrl !== undefined) void audio.play();
    }
  }, [playing, stream]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      const v = next ? 0 : volume;
      if (videoRef.current !== null) videoRef.current.volume = v;
      if (audioRef.current !== null) audioRef.current.volume = v;
      return next;
    });
  }, [volume]);

  const changeVolume = useCallback(
    (v: number) => {
      setVolume(v);
      if (v > 0) setMuted(false);
      if (videoRef.current !== null) videoRef.current.volume = v;
      if (audioRef.current !== null) audioRef.current.volume = v;
    },
    [],
  );

  const cycleRate = useCallback(() => {
    setRate((r) => {
      const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const idx = rates.indexOf(r);
      const next = rates[(idx + 1) % rates.length] ?? 1;
      if (videoRef.current !== null) videoRef.current.playbackRate = next;
      if (audioRef.current !== null) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    // 全屏「视频 + 控制条」的整体容器，保证全屏下仍可操作。
    const el = playerWrapRef.current;
    if (el === null) return;
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (video === null) return;
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) {
      const t = Math.max(0, Math.min(d, video.currentTime + delta));
      video.currentTime = t;
      if (audioRef.current !== null) audioRef.current.currentTime = t;
    }
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
        <button onClick={onBack} className="mb-4 flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />返回
        </button>

        <div
          ref={playerWrapRef}
          className={cn(
            "relative mb-4 overflow-hidden rounded-2xl bg-black",
            // 全屏时容器撑满视口，视频居中按 16:9 适配，控制条叠加在底部。
            fullscreen ? "flex h-screen w-screen flex-col" : "aspect-video w-full",
          )}
        >
          <div className={cn("relative w-full", fullscreen ? "flex-1 bg-black" : "aspect-video")}>
            <video
              ref={videoRef}
              className="h-full w-full"
              playsInline
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setPlaying(false)}
            />
            <audio ref={audioRef} className="hidden" />
            {/* 弹幕层（仅在有流且开启时渲染，覆盖视频上方，不拦截点击）。 */}
            {stream !== null && danmakuOn && danmakuItems.length > 0 ? (
              <DanmakuOverlay items={danmakuItems} currentTime={currentTime} paused={!playing} />
            ) : null}
            {stream !== null && danmakuOn && danmakuLoading ? (
              <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white/80">
                弹幕加载中…
              </div>
            ) : null}
            {stream === null && !streamLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                {detail.cover ? <img src={detail.cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" /> : null}
                <button onClick={() => void play(selectedCid)} className="relative z-10 rounded-full bg-white/90 p-4 text-black shadow-lg">
                  <Play className="h-8 w-8" />
                </button>
                <span className="relative z-10 text-sm text-white/80">点击播放</span>
              </div>
            ) : null}
            {streamLoading ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">取流中…</div>
            ) : null}
          </div>

          {stream !== null ? (
            <div
              className={cn(
                "flex items-center gap-3",
                fullscreen
                  ? "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-4 text-white"
                  : "bg-card p-3",
              )}
            >
              <button onClick={togglePlay} className={cn("rounded-full p-2", fullscreen ? "bg-white/20 text-white" : "bg-primary text-primary-foreground")}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button onClick={() => void seekBy(-10)} className="rounded-full p-2 text-muted-foreground hover:text-foreground">
                <SkipBack className="h-4 w-4" />
              </button>
              <button onClick={() => void seekBy(10)} className="rounded-full p-2 text-muted-foreground hover:text-foreground">
                <SkipForward className="h-4 w-4" />
              </button>
              <button onClick={toggleMute} className="rounded-full p-2 text-muted-foreground hover:text-foreground">
                {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-16 accent-primary"
                aria-label="音量"
              />
              <button
                onClick={() => setDanmakuOn((v) => !v)}
                className={cn(
                  "rounded-full p-2 transition-colors",
                  danmakuOn ? (fullscreen ? "bg-white/20 text-white" : "bg-primary/10 text-primary") : "text-muted-foreground hover:text-foreground",
                )}
                title={danmakuOn ? "关闭弹幕" : "开启弹幕"}
              >
                <MessageSquare className="h-4 w-4" />
              </button>
              <button
                onClick={cycleRate}
                className={cn("rounded-full px-2 py-1 text-xs font-medium transition-colors hover:text-foreground", fullscreen ? "text-white" : "text-muted-foreground")}
                title="切换倍速"
              >
                {rate}x
              </button>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  if (videoRef.current !== null) videoRef.current.currentTime = t;
                  if (audioRef.current !== null) audioRef.current.currentTime = t;
                }}
                className="flex-1"
              />
              <span className={cn("text-xs tabular-nums", fullscreen ? "text-white/80" : "text-muted-foreground")}>
                {fmtDuration(currentTime)} / {fmtDuration(duration)}
              </span>
              <button
                onClick={toggleFullscreen}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
                title={fullscreen ? "退出全屏" : "全屏"}
              >
                {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </div>
          ) : null}
        </div>

        <h1 className="text-xl font-bold">{detail.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {detail.author ? <span>{detail.author}</span> : null}
          {detail.play !== undefined ? <span>{fmtCount(detail.play)}播放</span> : null}
          {detail.danmaku !== undefined ? <span>{fmtCount(detail.danmaku)}弹幕</span> : null}
        </div>

        {pages.length > 1 ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">选集（{pages.length}）</p>
            <div className="flex flex-wrap gap-2">
              {pages.map((p) => (
                <button
                  key={p.cid}
                  onClick={() => {
                    setSelectedCid(p.cid);
                    // 已播放过则直接切换该分 P 的流与弹幕。
                    if (stream !== null) void play(p.cid);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    selectedCid === p.cid ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  P{p.page} {p.part}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex gap-2">
          <Button className="rounded-full" onClick={() => void play(selectedCid)}>
            <Play />播放
          </Button>
          <Button variant="outline" className="rounded-full" onClick={onDownload}>
            <Download />下载到 NAS
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => setShowFavAdd(true)}>
            <Star />收藏
          </Button>
        </div>

        {showFavAdd ? (
          <FavAddDialog
            aid={detail.aid}
            onClose={() => setShowFavAdd(false)}
            onToast={onToast}
          />
        ) : null}
      </div>
    </div>
  );
}

function FavAddDialog(props: { aid: number; onClose: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { aid, onClose, onToast } = props;
  const [folders, setFolders] = useState<FavFolderItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEscToClose(onClose, !submitting);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.fav.$get();
        const data = (await res.json()) as { folders?: FavFolderItem[] };
        setFolders(data.folders ?? []);
      } catch {
        onToast("获取收藏夹失败", "error");
      }
    })();
  }, [onToast]);
  const submit = async () => {
    if (selected === null) return;
    setSubmitting(true);
    try {
      const res = await rpc.api.bilibili.fav.add.$post({ json: { rid: selected, aid } });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.error !== undefined) onToast(`收藏失败 ${data.error}`, "error");
      else onToast("已收藏", "success");
    } catch {
      onToast("收藏失败");
    } finally {
      setSubmitting(false);
      onClose();
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">收藏到收藏夹</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 max-h-64 overflow-y-auto rounded-lg border">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelected(f.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                selected === f.id && "bg-muted",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{f.title}</span>
              <span className="text-xs text-muted-foreground">{f.mediaCount}</span>
            </button>
          ))}
          {folders.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">暂无收藏夹</p> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1 rounded-full" onClick={onClose}>取消</Button>
          <Button size="sm" className="flex-1 rounded-full" disabled={selected === null || submitting} onClick={() => void submit()}>收藏</Button>
        </div>
      </div>
    </div>
  );
}

function HistoryView(props: { onBack: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { onBack, onToast } = props;
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.history.$get();
        const data = (await res.json()) as { items?: HistoryEntry[] };
        setItems(data.items ?? []);
      } catch {
        onToast("获取历史失败", "error");
      }
    })();
  }, [onToast]);
  const clearAll = async () => {
    try {
      await rpc.api.bilibili.history.clear.$post();
      setItems([]);
      onToast("已清空历史", "success");
    } catch {
      onToast("清空失败", "error");
    }
  };
  const remove = async (kid: number) => {
    try {
      await rpc.api.bilibili.history.remove.$post({ json: { kid } });
      setItems((prev) => prev.filter((h) => h.kid !== kid));
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
          <h1 className="text-lg font-bold">历史记录（{items.length}）</h1>
          <button onClick={() => setConfirmClear(true)} className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive">
            清空
          </button>
        </div>
        {confirmClear ? (
          <ConfirmDialog
            title="清空历史记录"
            description="将清空 B 站账号的全部观看历史，此操作不可恢复。"
            confirmLabel="清空"
            destructive
            onConfirm={() => void clearAll()}
            onClose={() => setConfirmClear(false)}
          />
        ) : null}
        <ul className="divide-y divide-border/60">
          {items.map((h) => (
            <li key={h.kid} className="flex items-center gap-3 py-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
                {h.cover ? <img src={h.cover} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{h.title}</p>
                <p className="truncate text-xs text-muted-foreground">{h.author} · {fmtTime(h.viewAt)}</p>
              </div>
              <button onClick={() => void remove(h.kid)} className="shrink-0 rounded-full p-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {items.length === 0 ? <li><EmptyState icon={<History className="h-6 w-6" />} title="暂无历史记录" description="看过的视频会出现在这里" /></li> : null}
        </ul>
      </div>
    </div>
  );
}

function WatchLaterView(props: { onBack: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { onBack, onToast } = props;
  const [items, setItems] = useState<Array<{ aid: number; bvid?: string; title: string; cover?: string; duration?: number; owner?: string }>>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili["watch-later"].$get();
        const data = (await res.json()) as { items?: typeof items };
        setItems(data.items ?? []);
      } catch {
        onToast("获取失败", "error");
      }
    })();
  }, [onToast]);
  const remove = async (aid: number) => {
    try {
      await rpc.api.bilibili["watch-later"].remove.$post({ json: { aid } });
      setItems((prev) => prev.filter((t) => t.aid !== aid));
      onToast("已移除", "success");
    } catch {
      onToast("移除失败", "error");
    }
  };
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />返回
          </button>
          <h1 className="text-lg font-bold">稍后再看（{items.length}）</h1>
        </div>
        <ul className="divide-y divide-border/60">
          {items.map((t) => (
            <li key={t.aid} className="flex items-center gap-3 py-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
                {t.cover ? <img src={t.cover} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted-foreground">{t.owner} · {fmtDuration(t.duration)}</p>
              </div>
              <button onClick={() => void remove(t.aid)} className="shrink-0 rounded-full p-2 text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {items.length === 0 ? <li><EmptyState icon={<Clock className="h-6 w-6" />} title="稍后再看为空" description="收藏的稍后再看视频会出现在这里" /></li> : null}
        </ul>
      </div>
    </div>
  );
}

function FavView(props: { onBack: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onBack, onToast, onOpenVideo } = props;
  const [folders, setFolders] = useState<FavFolderItem[]>([]);
  const [content, setContent] = useState<Array<{ aid: number; bvid: string; title: string; cover?: string; duration?: number; owner?: string }> | null>(null);
  const [currentFolder, setCurrentFolder] = useState<FavFolderItem | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.fav.$get();
        const data = (await res.json()) as { folders?: FavFolderItem[] };
        setFolders(data.folders ?? []);
      } catch {
        onToast("获取收藏夹失败", "error");
      }
    })();
  }, [onToast]);
  const openFolder = async (f: FavFolderItem) => {
    setCurrentFolder(f);
    setContent(null);
    try {
      const res = await rpc.api.bilibili.fav.content.$get({ query: { id: String(f.id) } });
      const data = (await res.json()) as { items?: typeof content };
      setContent(data.items ?? []);
    } catch {
      onToast("获取内容失败", "error");
    }
  };
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />返回
          </button>
          <h1 className="text-lg font-bold">{currentFolder ? currentFolder.title : `收藏夹（${folders.length}）`}</h1>
        </div>
        {currentFolder === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => void openFolder(f)}
                className="group overflow-hidden rounded-2xl border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative aspect-video w-full bg-muted">
                  {f.cover ? (
                    <img src={f.cover} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-primary/10 via-card to-muted">
                      <Folder className="h-8 w-8 text-primary/50" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/60 to-transparent" />
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                    {f.mediaCount} 个内容
                  </span>
                </div>
                <p className="truncate px-3 py-2.5 text-sm font-medium">{f.title}</p>
              </button>
            ))}
            {folders.length === 0 ? (
              <div className="col-span-full">
                <EmptyState icon={<Folder className="h-6 w-6" />} title="暂无收藏夹" description="在 B 站收藏视频后，收藏夹会出现在这里" />
              </div>
            ) : null}
          </div>
        ) : content === null ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载中…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {content.map((it) => (
              <button
                key={it.aid}
                onClick={() => onOpenVideo(it.bvid)}
                className="group overflow-hidden rounded-2xl border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative aspect-video w-full bg-muted">
                  {it.cover ? (
                    <img src={it.cover} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <Play className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />
                  {it.duration !== undefined ? (
                    <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                      {fmtDuration(it.duration)}
                    </span>
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{it.title}</p>
                  {it.owner !== undefined ? (
                    <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Play className="h-3 w-3 fill-muted-foreground text-muted-foreground" />
                      {it.owner}
                    </p>
                  ) : null}
                </div>
              </button>
            ))}
            {content.length === 0 ? (
              <div className="col-span-full">
                <EmptyState icon={<Folder className="h-6 w-6" />} title="收藏夹为空" description="收藏的视频会出现在这里" />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function BangumiView(props: { onBack: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { onBack, onToast } = props;
  const [items, setItems] = useState<Array<{ seasonId: number; title: string; cover?: string; newEp?: string; typeName?: string; url?: string }>>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.bangumi.$get();
        const data = (await res.json()) as { items?: typeof items };
        setItems(data.items ?? []);
      } catch {
        onToast("获取追番失败", "error");
      }
    })();
  }, [onToast]);
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />返回
          </button>
          <h1 className="text-lg font-bold">追番（{items.length}）</h1>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((s) => (
            <a
              key={s.seasonId}
              href={s.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-xl border bg-card transition-all hover:-translate-y-0.5 hover:shadow-md"
              onClick={(e) => { if (s.url === undefined) e.preventDefault(); }}
            >
              <div className="aspect-[3/4] w-full bg-muted">
                {s.cover ? (
                  <img src={s.cover} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center" style={{ background: coverGradient(s.title) }}>
                    <ListVideo className="h-6 w-6 text-white/70" />
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="truncate text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.newEp ?? s.typeName ?? ""}</p>
              </div>
            </a>
          ))}
        </div>
        {items.length === 0 ? <EmptyState icon={<Star className="h-6 w-6" />} title="暂无追番" description="追过的番剧会出现在这里" /> : null}
      </div>
    </div>
  );
}

function PopularView(props: { onBack: () => void; onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onBack, onToast, onOpenVideo } = props;
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.popular.$get();
        const data = (await res.json()) as { videos?: BiliVideo[] };
        setVideos(data.videos ?? []);
      } catch {
        onToast("获取热门失败", "error");
      }
    })();
  }, [onToast]);
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />返回
          </button>
          <h1 className="text-lg font-bold">热门视频</h1>
        </div>
        <VideoGrid videos={videos} onOpen={onOpenVideo} />
      </div>
    </div>
  );
}

/** 「发现」视图：推荐流 / 综合热门 / 排行榜 / 每周必看 四个子 tab（对齐 Bilibili-Gate 的推荐体系）。 */
function DiscoverView(props: {
  tab: "recommend" | "popular" | "ranking" | "weekly" | "live" | "liked";
  onTabChange: (t: "recommend" | "popular" | "ranking" | "weekly" | "live" | "liked") => void;
  onBack: () => void;
  onToast: (m: string, type?: "success" | "error" | "info") => void;
  onOpenVideo: (bvid: string) => void;
}) {
  const { tab, onTabChange, onBack, onToast, onOpenVideo } = props;
  const tabs: Array<{ id: "recommend" | "popular" | "ranking" | "weekly" | "live" | "liked"; label: string; icon: React.ReactNode }> = [
    { id: "recommend", label: "推荐", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "popular", label: "综合热门", icon: <Flame className="h-3.5 w-3.5" /> },
    { id: "ranking", label: "排行榜", icon: <Trophy className="h-3.5 w-3.5" /> },
    { id: "weekly", label: "每周必看", icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { id: "live", label: "直播", icon: <Radio className="h-3.5 w-3.5" /> },
    { id: "liked", label: "点赞过", icon: <Heart className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6">
        <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />返回
        </button>
        <h1 className="text-lg font-bold">发现</h1>
        <div className="w-16" />
      </div>
      <div className="flex gap-1 border-b border-border/60 px-4 sm:px-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.id ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-4 py-6">
          {tab === "recommend" ? (
            <RecommendFeed onToast={onToast} onOpenVideo={onOpenVideo} />
          ) : tab === "popular" ? (
            <PopularFeed onToast={onToast} onOpenVideo={onOpenVideo} />
          ) : tab === "ranking" ? (
            <RankingFeed onToast={onToast} onOpenVideo={onOpenVideo} />
          ) : tab === "live" ? (
            <LiveFeed onToast={onToast} />
          ) : tab === "liked" ? (
            <LikedFeed onToast={onToast} onOpenVideo={onOpenVideo} />
          ) : (
            <WeeklyFeed onToast={onToast} onOpenVideo={onOpenVideo} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 推荐流：rcmd 信息流，无限滚动续拉（freshIdx/freshIdx1h 游标）。 */
function RecommendFeed(props: { onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onToast, onOpenVideo } = props;
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef({ freshIdx: 0, freshIdx1h: 0 });
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await rpc.api.bilibili.recommend.$get({
        query: { freshIdx: String(cursorRef.current.freshIdx), freshIdx1h: String(cursorRef.current.freshIdx1h) },
      });
      const data = (await res.json()) as { videos?: BiliVideo[]; freshIdx?: number; freshIdx1h?: number };
      const batch = data.videos ?? [];
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.bvid));
        return [...prev, ...batch.filter((v) => !seen.has(v.bvid))];
      });
      cursorRef.current = {
        freshIdx: data.freshIdx ?? cursorRef.current.freshIdx,
        freshIdx1h: data.freshIdx1h ?? cursorRef.current.freshIdx1h,
      };
      if (batch.length === 0) setHasMore(false);
    } catch {
      onToast("获取推荐失败", "error");
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  return (
    <div className="space-y-4">
      <VideoGrid videos={videos} onOpen={onOpenVideo} />
      {hasMore ? (
        <div className="flex justify-center py-4">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "加载中…" : "加载更多"}
          </Button>
        </div>
      ) : videos.length > 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">没有更多了</p>
      ) : null}
    </div>
  );
}

/** 综合热门（对齐原 PopularView 逻辑）。 */
function PopularFeed(props: { onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onToast, onOpenVideo } = props;
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.popular.$get();
        const data = (await res.json()) as { videos?: BiliVideo[] };
        setVideos(data.videos ?? []);
      } catch {
        onToast("获取热门失败", "error");
      }
    })();
  }, [onToast]);
  return <VideoGrid videos={videos} onOpen={onOpenVideo} />;
}

/** 排行榜：全站/分区切换。 */
function RankingFeed(props: { onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onToast, onOpenVideo } = props;
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  const [rid, setRid] = useState(0);
  const [loading, setLoading] = useState(false);
  // B 站分区 tid：0 全站 + 常用分区。
  const regions: Array<{ rid: number; label: string }> = [
    { rid: 0, label: "全站" },
    { rid: 1, label: "动画" },
    { rid: 3, label: "音乐" },
    { rid: 4, label: "游戏" },
    { rid: 36, label: "科技" },
    { rid: 160, label: "生活" },
    { rid: 119, label: "鬼畜" },
    { rid: 155, label: "娱乐" },
  ];
  useEffect(() => {
    setVideos([]);
    setLoading(true);
    void (async () => {
      try {
        const res = await rpc.api.bilibili.ranking.$get({ query: { rid: String(rid) } });
        const data = (await res.json()) as { videos?: BiliVideo[] };
        setVideos(data.videos ?? []);
      } catch {
        onToast("获取排行榜失败", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [rid, onToast]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {regions.map((r) => (
          <button
            key={r.rid}
            onClick={() => setRid(r.rid)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              rid === r.rid ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
      ) : (
        <VideoGrid videos={videos} onOpen={onOpenVideo} />
      )}
    </div>
  );
}

/** 每周必看：期数列表 → 点选查看该期视频。 */
function WeeklyFeed(props: { onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onToast, onOpenVideo } = props;
  const [episodes, setEpisodes] = useState<Array<{ number: number; title: string; cover?: string }>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.weekly.$get();
        const data = (await res.json()) as { episodes?: Array<{ number: number; title: string; cover?: string }> };
        setEpisodes(data.episodes ?? []);
      } catch {
        onToast("获取每周必看失败", "error");
      }
    })();
  }, [onToast]);
  useEffect(() => {
    if (selected === null) return;
    setVideos([]);
    setLoading(true);
    void (async () => {
      try {
        const res = await rpc.api.bilibili.weekly.videos.$get({ query: { number: String(selected) } });
        const data = (await res.json()) as { videos?: BiliVideo[] };
        setVideos(data.videos ?? []);
      } catch {
        onToast("获取周榜视频失败", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [selected, onToast]);
  if (selected === null) {
    return (
      <div className="space-y-3">
        {episodes.map((ep) => (
          <button
            key={ep.number}
            onClick={() => setSelected(ep.number)}
            className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
              {ep.number}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{ep.title}</span>
              <span className="block text-xs text-muted-foreground">第 {ep.number} 期</span>
            </span>
            <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
          </button>
        ))}
        {episodes.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">暂无期数</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <button onClick={() => setSelected(null)} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />返回期数列表
      </button>
      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
      ) : (
        <VideoGrid videos={videos} onOpen={onOpenVideo} />
      )}
    </div>
  );
}

function DownloadDialog(props: { video: BiliVideoDetail; onDownload: (path: string) => void; onClose: () => void }) {
  const { video, onDownload, onClose } = props;
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
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">下载到 NAS</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 truncate text-sm text-muted-foreground">{video.title}</p>
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
            <Download />下载
          </Button>
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex-1 animate-pulse overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 h-8 w-20 rounded-full bg-muted" />
        <div className="mb-4 aspect-video w-full rounded-2xl bg-muted" />
        <div className="h-6 w-2/3 rounded bg-muted" />
        <div className="mt-2 h-4 w-1/3 rounded bg-muted" />
      </div>
    </div>
  );
}

/** 直播：关注直播列表（分页，直播中在前）。 */
function LiveFeed(props: { onToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const { onToast } = props;
  const [rooms, setRooms] = useState<Array<{ roomid: number; liveStatus: number; title?: string; cover?: string; upName?: string; upMid?: number }>>([]);
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await rpc.api.bilibili.live.$get({ query: { page: String(p) } });
      const data = (await res.json()) as {
        rooms?: Array<{ roomid: number; liveStatus: number; title?: string; cover?: string; upName?: string; upMid?: number }>;
        totalPage?: number;
      };
      setRooms(data.rooms ?? []);
      setTotalPage(data.totalPage ?? 1);
    } catch {
      onToast("获取直播列表失败", "error");
    } finally {
      setLoading(false);
    }
  }, [onToast]);
  useEffect(() => { void load(page); }, [page, load]);
  return (
    <div className="space-y-4">
      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
      ) : rooms.length === 0 ? (
        <EmptyState icon={<Radio className="h-6 w-6" />} title="暂无关注直播" description="去关注一些主播后，这里会显示他们的直播间" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.map((r) => (
            <a
              key={r.roomid}
              href={`https://live.bilibili.com/${r.roomid}`}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-2xl border bg-card transition-colors hover:bg-muted"
            >
              <div className="relative aspect-video overflow-hidden bg-muted">
                {r.cover !== undefined ? <img src={r.cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                {r.liveStatus === 1 ? (
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-medium text-white">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />直播中
                  </span>
                ) : (
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">未开播</span>
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium">{r.title ?? r.upName ?? `房间 ${r.roomid}`}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.upName}</p>
              </div>
            </a>
          ))}
        </div>
      )}
      {totalPage > 1 ? (
        <div className="flex items-center justify-center gap-3 py-4">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPage}</span>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPage((p) => Math.min(totalPage, p + 1))} disabled={page >= totalPage}>
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 点赞过：点赞的视频列表。 */
function LikedFeed(props: { onToast: (m: string, type?: "success" | "error" | "info") => void; onOpenVideo: (bvid: string) => void }) {
  const { onToast, onOpenVideo } = props;
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.liked.$get();
        const data = (await res.json()) as { videos?: BiliVideo[]; count?: number };
        setVideos(data.videos ?? []);
        setCount(data.count ?? 0);
      } catch {
        onToast("获取点赞视频失败", "error");
      }
    })();
  }, [onToast]);
  return (
    <div className="space-y-4">
      {videos.length > 0 ? (
        <p className="text-xs text-muted-foreground">共 {count} 个点赞视频</p>
      ) : null}
      <VideoGrid videos={videos} onOpen={onOpenVideo} />
      {videos.length === 0 ? (
        <EmptyState icon={<Heart className="h-6 w-6" />} title="暂无点赞视频" description="给视频点赞后，它们会出现在这里" />
      ) : null}
    </div>
  );
}
