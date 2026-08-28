import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Heart,
  List,
  ListMusic,
  Moon,
  Music2,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  SkipBack,
  SkipForward,
  Sun,
  TextQuote,
  Volume2,
  VolumeX,
} from "lucide-react";
import { rpc } from "./lib/rpc";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tilt } from "@/components/ui/tilt";

interface AccountInfo {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
}

interface VipInfo {
  isVip: boolean;
  level: number;
  vipType: number;
}

interface PlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  specialType: number;
  coverUrl?: string;
  creatorName?: string;
}

interface AccountPayload {
  loggedIn: boolean;
  account?: AccountInfo;
  vip?: VipInfo;
  playlists?: PlaylistSummary[];
  error?: string;
}

interface Track {
  id: string;
  title: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  coverUrl?: string;
}

interface PlaylistDetail {
  title: string;
  coverUrl?: string;
  tracks: Track[];
}

interface LoginView {
  sessionId: string;
  qrDataUrl?: string;
  state: string;
  message: string;
}

interface LyricLine {
  time: number;
  text: string;
  translated?: string;
}

type RepeatMode = "off" | "all" | "one";

function formatDuration(ms?: number): string {
  if (ms === undefined || ms <= 0) return "--:--";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 歌词开头的元信息关键词（作词/作曲/编曲等，非演唱内容）。 */
const META_KEYWORDS = [
  "作词",
  "作曲",
  "编曲",
  "制作人",
  "混音",
  "母带",
  "录音",
  "和声",
  "吉他",
  "贝斯",
  "鼓",
  "键盘",
  "钢琴",
  "弦乐",
  "publisher",
  "instrumental",
  "vocals",
  "guitar",
  "bass",
  "drum",
  "composer",
  "arranged",
];

function isMetaLine(text: string): boolean {
  const t = text.toLowerCase();
  return META_KEYWORDS.some((k) => t.includes(k));
}

/** 解析 LRC 歌词为带时间戳的行，过滤开头的元信息行。 */
function parseLrc(lrc: string): Array<{ time: number; text: string }> {
  const out: Array<{ time: number; text: string }> = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lrc.split(/\r?\n/)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const times: number[] = [];
    while ((m = re.exec(line)) !== null) {
      const min = Number(m[1] ?? 0);
      const sec = Number(m[2] ?? 0);
      const fracRaw = m[3] ?? "0";
      const frac = Number(fracRaw) / (fracRaw.length === 2 ? 100 : fracRaw.length === 3 ? 1000 : 1);
      times.push(min * 60 + sec + frac);
    }
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    if (times.length === 0 || text === "") continue;
    // 过滤开头（<1s）的元信息行，只保留演唱歌词。
    if (times[0] !== undefined && times[0] < 1 && isMetaLine(text)) continue;
    for (const t of times) out.push({ time: t, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** 合并原文与翻译歌词（按时间戳对齐）。 */
function mergeLyrics(original?: string, translated?: string): LyricLine[] {
  const orig = original ? parseLrc(original) : [];
  const trans = translated ? parseLrc(translated) : [];
  if (trans.length === 0) return orig;
  const transMap = new Map<number, string>();
  for (const t of trans) transMap.set(Math.round(t.time * 1000), t.text);
  return orig.map((l) => {
    const tt = transMap.get(Math.round(l.time * 1000));
    return tt !== undefined ? { ...l, translated: tt } : l;
  });
}

/** 根据当前时间定位高亮歌词行。 */
function currentLineIndex(lines: LyricLine[], time: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && line.time <= time) idx = i;
    else break;
  }
  return idx;
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

export default function App() {
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [login, setLogin] = useState<LoginView | null>(null);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("all");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null) audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  const refresh = useCallback(async () => {
    setAccount(null);
    try {
      const res = await rpc.api.account.$get();
      setAccount((await res.json()) as AccountPayload);
    } catch {
      setAccount({ loggedIn: false, error: "服务不可达，请检查后端是否启动" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startLogin = useCallback(async () => {
    try {
      const res = await rpc.api.auth.start.$post({ json: { platform: "netease-music" } });
      const { sessionId } = (await res.json()) as { sessionId: string };
      setLogin({ sessionId, state: "waiting", message: "正在生成二维码…" });

      const es = new EventSource(`/api/auth/stream?id=${encodeURIComponent(sessionId)}`);
      es.addEventListener("qr", (e) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { qrDataUrl: string };
        setLogin((prev) => (prev ? { ...prev, qrDataUrl: data.qrDataUrl } : prev));
      });
      es.addEventListener("status", (e) => {
        const data = JSON.parse((e as MessageEvent).data as string) as { state: string; message: string };
        setLogin((prev) => (prev ? { ...prev, state: data.state, message: data.message } : prev));
        if (data.state === "success" || data.state === "failed" || data.state === "timeout") {
          es.close();
          if (data.state === "success") void refresh();
        }
      });
      es.onerror = () => {
        es.close();
        setLogin((prev) => (prev ? { ...prev, message: "连接中断，请重试" } : prev));
      };
    } catch {
      setAccount({ loggedIn: false, error: "发起登录失败，请重试" });
    }
  }, [refresh]);

  const openPlaylist = useCallback(async (id: string) => {
    setDetail(null);
    try {
      const res = await rpc.api.playlist.$get({ query: { id } });
      setDetail((await res.json()) as PlaylistDetail);
    } catch {
      setDetail({ title: "加载失败", tracks: [] });
    }
  }, []);

  /** 播放队列中指定索引的歌曲。 */
  const playAt = useCallback(async (tracks: Track[], index: number) => {
    const track = tracks[index];
    if (track === undefined) return;
    setQueue(tracks);
    setQueueIndex(index);
    setCurrentTrack(track);
    setProgress(0);
    setCurrentTime(0);
    setDuration(track.durationMs !== undefined ? track.durationMs / 1000 : 0);
    try {
      const res = await rpc.api.stream.$get({ query: { id: track.id } });
      const data = (await res.json()) as { url?: string; error?: string };
      const audio = audioRef.current;
      if (audio !== null && data.url !== undefined) {
        audio.src = data.url;
        await audio.play();
      }
    } catch {
      // 取流失败：保持播放栏显示，但不出声。
    }
  }, []);

  const playNext = useCallback(async () => {
    if (queue.length === 0) return;
    if (repeatMode === "one") {
      await playAt(queue, queueIndex);
      return;
    }
    const next = queueIndex + 1;
    if (next >= queue.length) {
      if (repeatMode === "all") await playAt(queue, 0);
      // off：到末尾停止，不动作。
      return;
    }
    await playAt(queue, next);
  }, [queue, queueIndex, repeatMode, playAt]);

  const playPrev = useCallback(async () => {
    if (queue.length === 0) return;
    const prev = queueIndex - 1 < 0 ? queue.length - 1 : queueIndex - 1;
    await playAt(queue, prev);
  }, [queue, queueIndex, playAt]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }, [playing]);

  const toggleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  const seek = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (audio === null) return;
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      audio.currentTime = Math.max(0, Math.min(1, ratio)) * d;
    }
  }, []);

  const seekBy = useCallback((deltaSec: number) => {
    const audio = audioRef.current;
    if (audio === null) return;
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      audio.currentTime = Math.max(0, Math.min(d, audio.currentTime + deltaSec));
    }
  }, []);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    if (v > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const openLyrics = useCallback(async (track: Track) => {
    setShowLyrics(true);
    setLyricLines([]);
    try {
      const res = await rpc.api.lyric.$get({ query: { id: track.id } });
      const data = (await res.json()) as { original?: string; translated?: string; error?: string };
      setLyricLines(mergeLyrics(data.original, data.translated));
    } catch {
      setLyricLines([]);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        seekBy(-5);
      } else if (e.code === "ArrowRight") {
        seekBy(5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Music2 className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold">音乐</span>
        </div>
        <div className="flex items-center gap-1">
          {account?.loggedIn && detail === null ? (
            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void refresh()}>
              <RefreshCw />
              刷新
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" className="rounded-full" onClick={toggle}>
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <div className={cn("flex min-h-0 flex-1 flex-col", currentTrack !== null && "pb-24")}>
        {detail !== null ? (
          <PlaylistView
            detail={detail}
            {...(currentTrack !== null ? { currentTrackId: currentTrack.id } : {})}
            onBack={() => setDetail(null)}
            onPlay={(t, i) => void playAt(detail.tracks, i)}
            onPlayAll={() => void playAt(detail.tracks, 0)}
          />
        ) : account === null ? (
          <HomeSkeleton />
        ) : account.loggedIn ? (
          <HomeView
            account={account}
            avatarError={avatarError}
            onAvatarError={() => setAvatarError(true)}
            onOpenPlaylist={(id) => void openPlaylist(id)}
            onPlaySong={(t) => void playAt([t], 0)}
          />
        ) : (
          <LoginView login={login} onLogin={() => void startLogin()} onCancel={() => setLogin(null)} />
        )}
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration > 0) setProgress((a.currentTime / a.duration) * 100);
          setCurrentTime(a.currentTime);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          void playNext();
        }}
        onError={() => setPlaying(false)}
      />

      <PlayerBar
        track={currentTrack}
        playing={playing}
        progress={progress}
        duration={duration}
        queueIndex={queueIndex}
        queueTotal={queue.length}
        repeatMode={repeatMode}
        volume={volume}
        muted={muted}
        onTogglePlay={togglePlay}
        onPrev={() => void playPrev()}
        onNext={() => void playNext()}
        onToggleRepeat={toggleRepeat}
        onSeek={seek}
        onToggleMute={toggleMute}
        onVolumeChange={changeVolume}
        onOpenLyrics={(t) => void openLyrics(t)}
        onOpenQueue={() => setShowQueue(true)}
      />

      {showLyrics && currentTrack !== null ? (
        <LyricsView
          track={currentTrack}
          lines={lyricLines}
          currentTime={currentTime}
          onClose={() => setShowLyrics(false)}
        />
      ) : null}

      {showQueue ? (
        <QueuePanel
          queue={queue}
          currentIndex={queueIndex}
          onPlay={(i) => void playAt(queue, i)}
          onClose={() => setShowQueue(false)}
        />
      ) : null}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex-1 animate-pulse overflow-auto">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-5 h-20 w-20 rounded-2xl bg-muted" />
        <div className="mb-2 h-8 w-48 rounded bg-muted" />
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-x-5 sm:gap-y-7 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square w-full rounded-xl bg-muted" />
              <div className="mt-2.5 h-4 w-3/4 rounded bg-muted" />
              <div className="mt-1.5 h-3 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QueuePanel(props: {
  queue: Track[];
  currentIndex: number;
  onPlay: (index: number) => void;
  onClose: () => void;
}) {
  const { queue, currentIndex, onPlay, onClose } = props;
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-slide-up rounded-t-2xl bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">播放队列（{queue.length}）</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>
        <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
          {queue.map((t, i) => {
            const isCurrent = i === currentIndex;
            return (
              <li key={t.id}>
                <button
                  onClick={() => onPlay(i)}
                  className={cn("flex w-full items-center gap-3 py-2.5 text-left", isCurrent && "text-primary")}
                >
                  <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-muted">
                    {t.coverUrl ? (
                      <img src={t.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.artists?.join(" / ")}</p>
                  </div>
                  {isCurrent ? <Music2 className="h-4 w-4 shrink-0 animate-pulse" /> : null}
                </button>
              </li>
            );
          })}
          {queue.length === 0 ? (
            <li className="py-10 text-center text-sm text-muted-foreground">暂无播放队列</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function LoginView(props: {
  login: LoginView | null;
  onLogin: () => void;
  onCancel: () => void;
}) {
  const { login, onLogin, onCancel } = props;
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm border-0 bg-card/70 shadow-lg backdrop-blur-xl">
        <CardHeader className="items-center text-center">
          <CardTitle>登录网易云音乐</CardTitle>
          <CardDescription>扫码登录一次，登录态自动同步到所有设备</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {login === null ? (
            <Button size="lg" className="rounded-full" onClick={onLogin}>
              <QrCode />
              扫码登录
            </Button>
          ) : (
            <>
              {login.qrDataUrl ? (
                <img
                  src={login.qrDataUrl}
                  alt="登录二维码"
                  className="h-56 w-56 max-w-full rounded-2xl bg-white p-2 shadow-sm sm:h-64 sm:w-64"
                />
              ) : (
                <div className="flex h-56 w-56 max-w-full items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground sm:h-64 sm:w-64">
                  二维码加载中…
                </div>
              )}
              <p className="text-sm text-muted-foreground">{login.message}</p>
              <Button variant="ghost" size="sm" className="rounded-full" onClick={onCancel}>
                取消
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HomeView(props: {
  account: AccountPayload;
  avatarError: boolean;
  onAvatarError: () => void;
  onOpenPlaylist: (id: string) => void;
  onPlaySong: (track: Track) => void;
}) {
  const { account, avatarError, onAvatarError, onOpenPlaylist, onPlaySong } = props;
  const [search, setSearch] = useState("");
  const [songQuery, setSongQuery] = useState("");
  const [songResults, setSongResults] = useState<Track[]>([]);
  const nickname = account.account?.nickname ?? "网易云用户";
  const avatarUrl = account.account?.avatarUrl;
  const vip = account.vip;
  const playlists = account.playlists ?? [];
  const liked = playlists.find((p) => p.specialType === 5);
  const others = playlists.filter((p) => p.specialType !== 5);
  const filtered =
    search.trim() === ""
      ? others
      : playlists.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (songQuery.trim() === "") {
      setSongResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await rpc.api.search.$get({ query: { q: songQuery } });
        const data = (await res.json()) as { songs?: Track[] };
        setSongResults(data.songs ?? []);
      } catch {
        setSongResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [songQuery]);

  return (
    <div className="flex-1 animate-fade-in overflow-auto">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-10">
          <Avatar className="mb-5 h-20 w-20 rounded-2xl">
            {avatarUrl && !avatarError ? (
              <AvatarImage src={avatarUrl} alt={nickname} onError={onAvatarError} />
            ) : null}
            <AvatarFallback className="rounded-2xl text-3xl">{nickname.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{nickname}</h1>
            {vip?.isVip ? <Badge variant="vip">VIP {vip.level}</Badge> : null}
          </div>
          {account.account?.signature ? (
            <p className="mt-2 text-muted-foreground">{account.account.signature}</p>
          ) : null}
        </div>

        {liked && search.trim() === "" && songQuery.trim() === "" ? (
          <button
            onClick={() => onOpenPlaylist(liked.id)}
            className="group mb-8 flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-primary/15 to-transparent p-4 text-left transition-shadow hover:shadow-md sm:gap-5 sm:p-5"
          >
            <Tilt className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted shadow-sm sm:h-24 sm:w-24">
              {liked.coverUrl ? (
                <img src={liked.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Heart className="h-8 w-8 text-primary" />
                </div>
              )}
            </Tilt>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                <Heart className="h-4 w-4 fill-primary" />
                我喜欢的音乐
              </p>
              <p className="mt-1 text-2xl font-bold">红心歌曲</p>
              <p className="mt-1 text-sm text-muted-foreground">{liked.trackCount} 首</p>
            </div>
          </button>
        ) : null}

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索歌单"
              className="rounded-full pl-9"
            />
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={songQuery}
              onChange={(e) => setSongQuery(e.target.value)}
              placeholder="搜索歌曲（网易云）"
              className="rounded-full pl-9"
            />
          </div>
        </div>

        {songQuery.trim() !== "" ? (
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
            <ul className="divide-y divide-border/60">
              {songResults.map((t, i) => (
                <li key={t.id}>
                  <button
                    onClick={() => onPlaySong(t)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 sm:gap-4 sm:px-4"
                  >
                    <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
                      {t.coverUrl ? (
                        <img src={t.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ListMusic className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[t.artists?.join(" / "), t.album].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDuration(t.durationMs)}
                    </span>
                  </button>
                </li>
              ))}
              {songResults.length === 0 ? (
                <li className="py-10 text-center text-sm text-muted-foreground">无搜索结果</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-2.5">
              <ListMusic className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-bold">
                {search.trim() === "" ? "歌单" : `搜索结果（${filtered.length}）`}
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-5 sm:gap-y-7 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {filtered.map((p) => (
                <button key={p.id} onClick={() => onOpenPlaylist(p.id)} className="group text-left">
                  <Tilt className="aspect-square w-full overflow-hidden rounded-xl bg-muted shadow-sm transition-shadow duration-300 group-hover:shadow-xl">
                    {p.coverUrl ? (
                      <img
                        src={p.coverUrl}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ListMusic className="h-10 w-10" />
                      </div>
                    )}
                  </Tilt>
                  <p className="mt-2.5 truncate text-base font-medium">{p.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.trackCount} 首</p>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                  没有匹配的歌单
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PlaylistView(props: {
  detail: PlaylistDetail;
  currentTrackId?: string;
  onBack: () => void;
  onPlay: (track: Track, index: number) => void;
  onPlayAll: () => void;
}) {
  const { detail, currentTrackId, onBack, onPlay, onPlayAll } = props;
  return (
    <div className="flex-1 animate-slide-in-right overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        <Button variant="ghost" size="sm" className="mb-6 rounded-full" onClick={onBack}>
          <ChevronLeft />
          返回
        </Button>

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          <Tilt className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-muted shadow-md sm:h-44 sm:w-44">
            {detail.coverUrl ? (
              <img src={detail.coverUrl} alt={detail.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ListMusic className="h-12 w-12" />
              </div>
            )}
          </Tilt>
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">歌单</p>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">{detail.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{detail.tracks.length} 首歌曲</p>
            <Button size="sm" className="mt-4 rounded-full" onClick={onPlayAll}>
              <Play className="mr-1 h-4 w-4" />
              播放全部
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
          <ul className="divide-y divide-border/60">
            {detail.tracks.map((t, i) => {
              const isCurrent = t.id === currentTrackId;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => onPlay(t, i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 sm:gap-4 sm:px-4",
                      isCurrent && "bg-primary/5",
                    )}
                  >
                    <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {t.coverUrl ? (
                        <img
                          src={t.coverUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ListMusic className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", isCurrent && "text-primary")}>
                        {t.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[t.artists?.join(" / "), t.album].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {isCurrent ? (
                      <Music2 className="h-4 w-4 shrink-0 animate-pulse text-primary" />
                    ) : (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatDuration(t.durationMs)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {detail.tracks.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">暂无歌曲</li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

function PlayerBar(props: {
  track: Track | null;
  playing: boolean;
  progress: number;
  duration: number;
  queueIndex: number;
  queueTotal: number;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleRepeat: () => void;
  onSeek: (ratio: number) => void;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
  onOpenLyrics: (track: Track) => void;
  onOpenQueue: () => void;
}) {
  const {
    track,
    playing,
    progress,
    duration,
    queueIndex,
    queueTotal,
    repeatMode,
    volume,
    muted,
    onTogglePlay,
    onPrev,
    onNext,
    onToggleRepeat,
    onSeek,
    onToggleMute,
    onVolumeChange,
    onOpenLyrics,
    onOpenQueue,
  } = props;
  if (track === null) return null;

  const totalSec = duration > 0 ? duration : (track.durationMs !== undefined ? track.durationMs / 1000 : 0);
  const currentSec = totalSec * (progress / 100);

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 animate-slide-up border-t border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
        <button
          onClick={() => onOpenLyrics(track)}
          className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted shadow-sm sm:h-12 sm:w-12"
          title="查看歌词"
        >
          {track.coverUrl ? (
            <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ListMusic className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </button>
        <button onClick={() => onOpenLyrics(track)} className="w-28 min-w-0 text-left sm:w-40">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[track.artists?.join(" / "), queueTotal > 0 ? `${queueIndex + 1}/${queueTotal}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </button>

        <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(Math.round(currentSec) * 1000)}
          </span>
          <div
            className="group/bar relative h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-muted"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(Math.round(totalSec) * 1000)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onToggleRepeat}
            className={cn(
              "rounded-full p-1.5 transition-colors hover:text-foreground",
              repeatMode === "off" ? "text-muted-foreground" : "text-primary",
            )}
            title={repeatMode === "off" ? "顺序播放" : repeatMode === "all" ? "列表循环" : "单曲循环"}
          >
            {repeatMode === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
          </button>
          <button
            onClick={onPrev}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="上一首"
          >
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            onClick={onTogglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-transform hover:scale-105 hover:bg-primary/90"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <button
            onClick={onNext}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="下一首"
          >
            <SkipForward className="h-5 w-5" />
          </button>
          <button
            onClick={() => onOpenLyrics(track)}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="查看歌词"
          >
            <TextQuote className="h-5 w-5" />
          </button>
          <button
            onClick={onOpenQueue}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="播放队列"
          >
            <List className="h-5 w-5" />
          </button>
          <div className="ml-1 hidden items-center gap-1.5 md:flex">
            <button
              onClick={onToggleMute}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              title={muted ? "取消静音" : "静音"}
            >
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-20 accent-primary"
              aria-label="音量"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LyricsView(props: {
  track: Track;
  lines: LyricLine[];
  currentTime: number;
  onClose: () => void;
}) {
  const { track, lines, currentTime, onClose } = props;
  const activeIdx = currentLineIndex(lines, currentTime);

  useEffect(() => {
    if (activeIdx < 0) return;
    document.getElementById(`lyric-${activeIdx}`)?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [activeIdx]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black">
      {track.coverUrl ? (
        <img
          src={track.coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between px-6 py-5">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-white">{track.title}</p>
            <p className="truncate text-sm text-white/70">{track.artists?.join(" / ")}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronDown className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-32 [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-7 py-[45vh] text-center">
            {lines.length === 0 ? (
              <p className="text-white/50">暂无歌词</p>
            ) : (
              lines.map((l, i) => (
                <div
                  key={i}
                  id={`lyric-${i}`}
                  className={cn(
                    "transition-all duration-300",
                    i === activeIdx
                      ? "text-3xl font-bold text-white"
                      : "text-xl font-medium text-white/40",
                  )}
                >
                  <p>{l.text}</p>
                  {l.translated !== undefined && i === activeIdx ? (
                    <p className="mt-1.5 text-base text-white/60">{l.translated}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
