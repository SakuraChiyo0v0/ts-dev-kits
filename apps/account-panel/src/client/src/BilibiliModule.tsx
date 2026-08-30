import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Clock,
  Download,
  Flame,
  Folder,
  FolderPlus,
  History,
  ListVideo,
  LogOut,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { rpc } from "./lib/rpc";
import DownloadHistoryPanel from "./DownloadHistoryPanel";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ---------- 类型 ----------

interface BiliAccount {
  loggedIn: boolean;
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

export default function BilibiliModule({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<BiliAccount | null>(null);
  const [login, setLogin] = useState<LoginView | null>(null);
  const [view, setView] = useState<"home" | "history" | "watchLater" | "fav" | "bangumi" | "popular">("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BiliVideo[]>([]);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<BiliVideoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<BiliVideoDetail | null>(null);
  const [showDownloadHistory, setShowDownloadHistory] = useState(false);
  const loginEsRef = useRef<EventSource | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const res = await rpc.api.bilibili.account.$get();
      setAccount((await res.json()) as BiliAccount);
    } catch {
      setAccount({ loggedIn: false });
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
      showToast("搜索失败");
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
      showToast("获取视频失败");
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  const logout = useCallback(async () => {
    try {
      await rpc.api.bilibili.logout.$post();
      showToast("已退出登录");
      await refreshAccount();
    } catch {
      showToast("退出失败");
    }
  }, [refreshAccount, showToast]);

  // ---------- 未登录：绑定页 ----------
  if (account !== null && !account.loggedIn) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />服务列表
          </button>
          <span className="text-base font-semibold">哔哩哔哩</span>
        </header>
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-sm border-0 bg-card/70 shadow-lg backdrop-blur-xl">
            <CardHeader className="items-center text-center">
              <CardTitle>绑定哔哩哔哩</CardTitle>
              <CardDescription>扫码登录 B 站，登录态同步到统一账号</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              {login === null ? (
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
              <Button variant="ghost" size="sm" className="rounded-full" onClick={onBack}>返回服务列表</Button>
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
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />服务列表
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ListVideo className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold">哔哩哔哩</span>
        </div>
        <div className="flex items-center gap-1">
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
          <PopularView onBack={() => setView("home")} onToast={showToast} onOpenVideo={(bvid) => void openDetail(bvid)} />
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
            onOpenPopular={() => setView("popular")}
          />
        )}
      </div>

      {toast !== null ? (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 animate-fade-in rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}

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
async function downloadToNas(video: BiliVideoDetail, path: string, toast: (m: string) => void): Promise<void> {
  try {
    const res = await rpc.api.bilibili.download.$post({
      json: { bvid: video.bvid, ...(video.cid !== undefined ? { cid: video.cid } : {}), ...(path.trim() !== "" ? { path: path.trim() } : {}) },
    });
    const data = (await res.json()) as { filePath?: string; error?: string };
    if (data.error !== undefined) toast(`下载失败 ${data.error}`);
    else toast("已下载到 NAS");
  } catch {
    toast("下载失败");
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
}) {
  const { account, query, setQuery, searching, results, onSearch, onOpenVideo, onOpenHistory, onOpenWatchLater, onOpenFav, onOpenBangumi, onOpenPopular } = props;
  const info = account?.account;
  const [avatarError, setAvatarError] = useState(false);
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

        <div className="mb-6 flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 B 站视频…"
            className="rounded-full"
            onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
          />
          <Button className="rounded-full" onClick={onSearch} disabled={searching}>
            <Search />搜索
          </Button>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <EntryButton icon={<Flame />} label="热门" onClick={onOpenPopular} />
          <EntryButton icon={<History />} label="历史记录" onClick={onOpenHistory} />
          <EntryButton icon={<Clock />} label="稍后再看" onClick={onOpenWatchLater} />
          <EntryButton icon={<Folder />} label="收藏夹" onClick={onOpenFav} />
          <EntryButton icon={<Star />} label="追番" onClick={onOpenBangumi} />
        </div>

        {results.length > 0 ? (
          <VideoGrid videos={results} onOpen={onOpenVideo} />
        ) : searching ? (
          <p className="py-16 text-center text-sm text-muted-foreground">搜索中…</p>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">输入关键词搜索 B 站视频</p>
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
  onToast: (m: string) => void;
  onDownload: () => void;
}) {
  const { detail, onBack, onToast, onDownload } = props;
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [selectedCid, setSelectedCid] = useState<number | undefined>(detail.cid);
  const [showFavAdd, setShowFavAdd] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pages = detail.pages ?? [];

  const play = useCallback(async (cid?: number) => {
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
    } catch {
      onToast("取流失败");
    } finally {
      setStreamLoading(false);
    }
  }, [detail.bvid, onToast]);

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
      if (videoRef.current !== null) videoRef.current.volume = next ? 0 : 1;
      if (audioRef.current !== null) audioRef.current.volume = next ? 0 : 1;
      return next;
    });
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

        <div className="relative mb-4 aspect-video w-full overflow-hidden rounded-2xl bg-black">
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
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-card p-3">
            <button onClick={togglePlay} className="rounded-full bg-primary p-2 text-primary-foreground">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button onClick={() => void seekBy(-10)} className="rounded-full p-2 text-muted-foreground hover:text-foreground">
              <SkipBack className="h-4 w-4" />
            </button>
            <button onClick={() => void seekBy(10)} className="rounded-full p-2 text-muted-foreground hover:text-foreground">
              <SkipForward className="h-4 w-4" />
            </button>
            <button onClick={toggleMute} className="rounded-full p-2 text-muted-foreground hover:text-foreground">
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
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
            <span className="text-xs tabular-nums text-muted-foreground">
              {fmtDuration(currentTime)} / {fmtDuration(duration)}
            </span>
          </div>
        ) : null}

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
                  onClick={() => setSelectedCid(p.cid)}
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

function FavAddDialog(props: { aid: number; onClose: () => void; onToast: (m: string) => void }) {
  const { aid, onClose, onToast } = props;
  const [folders, setFolders] = useState<FavFolderItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.fav.$get();
        const data = (await res.json()) as { folders?: FavFolderItem[] };
        setFolders(data.folders ?? []);
      } catch {
        onToast("获取收藏夹失败");
      }
    })();
  }, [onToast]);
  const submit = async () => {
    if (selected === null) return;
    setSubmitting(true);
    try {
      const res = await rpc.api.bilibili.fav.add.$post({ json: { rid: selected, aid } });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.error !== undefined) onToast(`收藏失败 ${data.error}`);
      else onToast("已收藏");
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

function HistoryView(props: { onBack: () => void; onToast: (m: string) => void }) {
  const { onBack, onToast } = props;
  const [items, setItems] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.history.$get();
        const data = (await res.json()) as { items?: HistoryEntry[] };
        setItems(data.items ?? []);
      } catch {
        onToast("获取历史失败");
      }
    })();
  }, [onToast]);
  const clearAll = async () => {
    try {
      await rpc.api.bilibili.history.clear.$post();
      setItems([]);
      onToast("已清空历史");
    } catch {
      onToast("清空失败");
    }
  };
  const remove = async (kid: number) => {
    try {
      await rpc.api.bilibili.history.remove.$post({ json: { kid } });
      setItems((prev) => prev.filter((h) => h.kid !== kid));
    } catch {
      onToast("删除失败");
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
          <button onClick={() => void clearAll()} className="rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive">
            清空
          </button>
        </div>
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
          {items.length === 0 ? <li className="py-16 text-center text-sm text-muted-foreground">暂无历史记录</li> : null}
        </ul>
      </div>
    </div>
  );
}

function WatchLaterView(props: { onBack: () => void; onToast: (m: string) => void }) {
  const { onBack, onToast } = props;
  const [items, setItems] = useState<Array<{ aid: number; bvid?: string; title: string; cover?: string; duration?: number; owner?: string }>>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili["watch-later"].$get();
        const data = (await res.json()) as { items?: typeof items };
        setItems(data.items ?? []);
      } catch {
        onToast("获取失败");
      }
    })();
  }, [onToast]);
  const remove = async (aid: number) => {
    try {
      await rpc.api.bilibili["watch-later"].remove.$post({ json: { aid } });
      setItems((prev) => prev.filter((t) => t.aid !== aid));
      onToast("已移除");
    } catch {
      onToast("移除失败");
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
          {items.length === 0 ? <li className="py-16 text-center text-sm text-muted-foreground">稍后再看为空</li> : null}
        </ul>
      </div>
    </div>
  );
}

function FavView(props: { onBack: () => void; onToast: (m: string) => void; onOpenVideo: (bvid: string) => void }) {
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
        onToast("获取收藏夹失败");
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
      onToast("获取内容失败");
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {folders.map((f) => (
              <button key={f.id} onClick={() => void openFolder(f)} className="rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md">
                <p className="truncate text-sm font-medium">{f.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{f.mediaCount} 个内容</p>
              </button>
            ))}
          </div>
        ) : content === null ? (
          <p className="py-16 text-center text-sm text-muted-foreground">加载中…</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {content.map((it) => (
              <li key={it.aid} className="flex items-center gap-3 py-3">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
                  {it.cover ? <img src={it.cover} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <button onClick={() => onOpenVideo(it.bvid)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{it.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{it.owner} · {fmtDuration(it.duration)}</p>
                </button>
              </li>
            ))}
            {content.length === 0 ? <li className="py-16 text-center text-sm text-muted-foreground">收藏夹为空</li> : null}
          </ul>
        )}
      </div>
    </div>
  );
}

function BangumiView(props: { onBack: () => void; onToast: (m: string) => void }) {
  const { onBack, onToast } = props;
  const [items, setItems] = useState<Array<{ seasonId: number; title: string; cover?: string; newEp?: string; typeName?: string; url?: string }>>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.bangumi.$get();
        const data = (await res.json()) as { items?: typeof items };
        setItems(data.items ?? []);
      } catch {
        onToast("获取追番失败");
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
        {items.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">暂无追番</p> : null}
      </div>
    </div>
  );
}

function PopularView(props: { onBack: () => void; onToast: (m: string) => void; onOpenVideo: (bvid: string) => void }) {
  const { onBack, onToast, onOpenVideo } = props;
  const [videos, setVideos] = useState<BiliVideo[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await rpc.api.bilibili.popular.$get();
        const data = (await res.json()) as { videos?: BiliVideo[] };
        setVideos(data.videos ?? []);
      } catch {
        onToast("获取热门失败");
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

function DownloadDialog(props: { video: BiliVideoDetail; onDownload: (path: string) => void; onClose: () => void }) {
  const { video, onDownload, onClose } = props;
  const [path, setPath] = useState("");
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
