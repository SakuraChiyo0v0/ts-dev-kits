import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Download,
  HardDriveDownload,
  Heart,
  List,
  ListMusic,
  ListPlus,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Share,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Flame,
  Folder,
  FolderPlus,
  Sun,
  TextQuote,
  Trash2,
  Volume2,
  VolumeX,
  X,
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
  id: string;
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

/** 播放量格式化（万/亿）。 */
function formatCount(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

/** 根据名称生成稳定的渐变背景（无封面时的 fallback）。 */
function coverGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 70) % 360;
  return `linear-gradient(135deg, hsl(${h1} 75% 45%), hsl(${h2} 75% 35%))`;
}

/** 复制文本到剪贴板；http 非安全上下文下回退到 execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略，走 fallback。
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
  }, [theme]);

  // 用户未手动选过主题时，跟随系统偏好实时切换。
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem("theme") === null) {
        setTheme(e.matches ? "dark" : "light");
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      return next;
    });
  };

  return { theme, toggle };
}

export default function App() {
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [login, setLogin] = useState<LoginView | null>(null);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => {
    try {
      const m = localStorage.getItem("repeat-mode");
      return m === "off" || m === "all" || m === "one" ? m : "all";
    } catch {
      return "all";
    }
  });
  const [shuffle, setShuffle] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [songDetail, setSongDetail] = useState<Track | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<Track | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showDownloadHistory, setShowDownloadHistory] = useState(false);
  const [downloadRecords, setDownloadRecords] = useState<
    Array<{ id: string; filename: string; filePath: string; status: string; time: string }>
  >([]);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    done: number;
    status: string;
  } | null>(null);
  const [downloadedVersion, setDownloadedVersion] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [recommend, setRecommend] = useState<Track[]>([]);
  const [recommendPlaylists, setRecommendPlaylists] = useState<
    Array<{ id: string; name: string; coverUrl?: string; playCount: number }>
  >([]);
  const [fetching, setFetching] = useState(0);
  const [likedCurrent, setLikedCurrent] = useState(false);
  const [volume, setVolume] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("volume");
      if (raw === null) return 1;
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [level, setLevel] = useState<string>("exhigh");
  const [rate, setRate] = useState(1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [recentTracks, setRecentTracks] = useState<Track[]>(() => {
    try {
      const raw = localStorage.getItem("recent-tracks");
      return raw ? (JSON.parse(raw) as Track[]) : [];
    } catch {
      return [];
    }
  });
  const [lastTrack, setLastTrack] = useState<Track | null>(() => {
    try {
      const raw = localStorage.getItem("last-track");
      return raw ? (JSON.parse(raw) as Track) : null;
    } catch {
      return null;
    }
  });
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("play-counts");
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const pendingSeek = useRef<number | null>(null);
  const lastPosSave = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 播放竞态 token：每次 playAt/changeLevel 递增，settle 后比对丢弃旧请求。
  const playTokenRef = useRef(0);
  const batchTimerRef = useRef<number | null>(null);
  const loginEsRef = useRef<EventSource | null>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null) audio.volume = muted ? 0 : volume;
    try {
      // 音量调到 0 时不持久化，刷新后恢复默认 1，避免「默认音量总是 0」。
      if (volume > 0) {
        localStorage.setItem("volume", String(volume));
      } else {
        localStorage.removeItem("volume");
      }
    } catch {
      // 忽略。
    }
  }, [volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null) audio.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    if (sleepMinutes === null) return;
    const id = window.setTimeout(() => {
      audioRef.current?.pause();
      setSleepMinutes(null);
    }, sleepMinutes * 60 * 1000);
    return () => window.clearTimeout(id);
  }, [sleepMinutes]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setAccount(null);
    setFetching((n) => n + 1);
    try {
      const res = await rpc.api.account.$get();
      setAccount((await res.json()) as AccountPayload);
    } catch {
      setAccount({ loggedIn: false, error: "服务不可达，请检查后端是否启动" });
    } finally {
      setFetching((n) => n - 1);
    }
    void (async () => {
      try {
        const res = await rpc.api.liked.$get();
        const data = (await res.json()) as { ids?: string[] };
        if (data.ids !== undefined) setLikedIds(new Set(data.ids));
      } catch {
        // 忽略。
      }
    })();
    void (async () => {
      try {
        const res = await rpc.api.recommend.$get();
        const data = (await res.json()) as { songs?: Track[] };
        if (data.songs !== undefined) setRecommend(data.songs);
      } catch {
        // 忽略。
      }
    })();
    void (async () => {
      try {
        const res = await rpc.api["recommend-playlists"].$get();
        const data = (await res.json()) as {
          playlists?: Array<{ id: string; name: string; coverUrl?: string; playCount: number }>;
        };
        if (data.playlists !== undefined) setRecommendPlaylists(data.playlists);
      } catch {
        // 忽略。
      }
    })();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 卸载时清理批量下载轮询 timer 与登录 EventSource。
  useEffect(() => {
    return () => {
      if (batchTimerRef.current !== null) window.clearTimeout(batchTimerRef.current);
      loginEsRef.current?.close();
    };
  }, []);

  const startLogin = useCallback(async () => {
    try {
      const res = await rpc.api.auth.start.$post({ json: { platform: "netease-music" } });
      const { sessionId } = (await res.json()) as { sessionId: string };
      setLogin({ sessionId, state: "waiting", message: "正在生成二维码…" });

      // 关闭旧的 EventSource（重新登录/取消时）。
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
          if (data.state === "success") void refresh();
        }
      });
      es.onerror = () => {
        es.close();
        loginEsRef.current = null;
        setLogin((prev) => (prev ? { ...prev, message: "连接中断，请重试" } : prev));
      };
    } catch {
      setAccount({ loggedIn: false, error: "发起登录失败，请重试" });
    }
  }, [refresh]);

  const openPlaylist = useCallback(async (id: string) => {
    setDetail(null);
    setDetailLoading(true);
    setFetching((n) => n + 1);
    try {
      const res = await rpc.api.playlist.$get({ query: { id } });
      setDetail((await res.json()) as PlaylistDetail);
    } catch {
      setDetail({ id: "", title: "加载失败", tracks: [] });
    } finally {
      setDetailLoading(false);
      setFetching((n) => n - 1);
    }
  }, []);

  /** 播放队列中指定索引的歌曲。 */
  const playAt = useCallback(async (tracks: Track[], index: number) => {
    const track = tracks[index];
    if (track === undefined) return;
    const token = ++playTokenRef.current;
    // iOS Safari 自动播放解锁：在用户手势同步上下文里先静音触发一次 play()。
    const audioEl = audioRef.current;
    if (audioEl !== null) {
      audioEl.muted = true;
      void audioEl.play().catch(() => {});
    }
    setQueue(tracks);
    setQueueIndex(index);
    setCurrentTrack(track);
    setLikedCurrent(likedIds.has(track.id));
    setRecentTracks((prev) => {
      const next = [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 30);
      try {
        localStorage.setItem("recent-tracks", JSON.stringify(next));
      } catch {
        // localStorage 不可用时忽略。
      }
      return next;
    });
    setLastTrack(track);
    try {
      localStorage.setItem("last-track", JSON.stringify(track));
    } catch {
      // 忽略。
    }
    setPlayCounts((prev) => {
      const next = { ...prev, [track.id]: (prev[track.id] ?? 0) + 1 };
      try {
        localStorage.setItem("play-counts", JSON.stringify(next));
      } catch {
        // 忽略。
      }
      return next;
    });
    document.title = `${track.title}${track.artists?.length ? ` · ${track.artists.join(" / ")}` : ""}`;
    // 搜索结果无封面时，异步补一次歌曲详情封面。
    if (track.coverUrl === undefined) {
      void (async () => {
        try {
          const res = await rpc.api.song.$get({ query: { id: track.id } });
          const info = (await res.json()) as { coverUrl?: string };
          const coverUrl = info.coverUrl;
          if (coverUrl !== undefined) {
            setCurrentTrack((prev) =>
              prev !== null && prev.id === track.id ? { ...prev, coverUrl } : prev,
            );
          }
        } catch {
          // 忽略补齐失败。
        }
      })();
    }
    setProgress(0);
    setCurrentTime(0);
    setDuration(track.durationMs !== undefined ? track.durationMs / 1000 : 0);
    try {
      const res = await rpc.api.stream.$get({ query: { id: track.id } });
      const data = (await res.json()) as { url?: string; level?: string; error?: string };
      const audio = audioRef.current;
      if (audio !== null && data.url !== undefined) {
        if (token !== playTokenRef.current) return; // 已有更新的播放请求，丢弃本次。
        audio.src = data.url;
        if (data.level !== undefined) setLevel(data.level);
        audio.muted = false;
        // 恢复音量：遵循 React 的 muted/volume 状态，避免静音后切歌被强制出声。
        audio.volume = muted ? 0 : volume;
        await audio.play();
      }
    } catch (error) {
      // 取流失败：保持播放栏显示，但不出声。
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      showToast(`播放失败 ${detail}`);
    }
  }, [showToast, likedIds, muted, volume]);

  const playPlaylist = useCallback(
    async (id: string) => {
      try {
        const res = await rpc.api.playlist.$get({ query: { id } });
        const d = (await res.json()) as PlaylistDetail;
        if (d.tracks.length > 0) await playAt(d.tracks, 0);
      } catch {
        showToast("播放失败");
      }
    },
    [playAt, showToast],
  );

  const playPersonalFm = useCallback(async () => {
    try {
      const res = await rpc.api["personal-fm"].$get();
      const data = (await res.json()) as { songs?: Track[] };
      if (data.songs !== undefined && data.songs.length > 0) {
        await playAt(data.songs, 0);
      } else {
        showToast("暂无电台歌曲");
      }
    } catch {
      showToast("获取电台失败");
    }
  }, [playAt, showToast]);

  const playNext = useCallback(async () => {
    if (queue.length === 0) return;
    if (repeatMode === "one") {
      await playAt(queue, queueIndex);
      return;
    }
    if (shuffle) {
      let next = queueIndex;
      if (queue.length > 1) {
        do {
          next = Math.floor(Math.random() * queue.length);
        } while (next === queueIndex);
      }
      await playAt(queue, next);
      return;
    }
    const next = queueIndex + 1;
    if (next >= queue.length) {
      if (repeatMode === "all") await playAt(queue, 0);
      // off：到末尾停止，不动作。
      return;
    }
    await playAt(queue, next);
  }, [queue, queueIndex, repeatMode, shuffle, playAt]);

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
    setRepeatMode((m) => {
      const next = m === "off" ? "all" : m === "all" ? "one" : "off";
      try {
        localStorage.setItem("repeat-mode", next);
      } catch {
        // 忽略。
      }
      return next;
    });
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

  const cycleRate = useCallback(() => {
    setRate((r) => {
      const rates = [0.75, 1, 1.25, 1.5, 2];
      const idx = rates.indexOf(r);
      return rates[(idx + 1) % rates.length] ?? 1;
    });
  }, []);

  const cycleSleep = useCallback(() => {
    setSleepMinutes((m) => (m === null ? 15 : m === 15 ? 30 : m === 30 ? 60 : null));
  }, []);

  const clearRecent = useCallback(() => {
    setRecentTracks([]);
    try {
      localStorage.removeItem("recent-tracks");
    } catch {
      // 忽略。
    }
  }, []);

  const changeLevel = useCallback(async () => {
    if (currentTrack === null) return;
    const token = ++playTokenRef.current;
    const levels = ["exhigh", "higher", "standard"];
    const idx = levels.indexOf(level);
    const next = levels[(idx + 1) % levels.length] ?? "exhigh";
    const pos = audioRef.current?.currentTime ?? 0;
    try {
      const res = await rpc.api.stream.$get({ query: { id: currentTrack.id, level: next } });
      const data = (await res.json()) as { url?: string; level?: string };
      if (audioRef.current !== null && data.url !== undefined) {
        if (token !== playTokenRef.current) return;
        audioRef.current.src = data.url;
        if (data.level !== undefined) setLevel(data.level);
        audioRef.current.currentTime = pos;
        void audioRef.current.play();
      }
    } catch {
      showToast("切换音质失败");
    }
  }, [currentTrack, level, showToast]);

  const shareTrack = useCallback(
    async (track: Track) => {
      const ok = await copyText(`https://music.163.com/song?id=${track.id}`);
      showToast(ok ? "已复制歌曲链接" : "复制失败");
    },
    [showToast],
  );

  const sharePlaylist = useCallback(
    async (id: string) => {
      const ok = await copyText(`https://music.163.com/playlist?id=${id}`);
      showToast(ok ? "已复制歌单链接" : "复制失败");
    },
    [showToast],
  );

  const downloadToLocal = useCallback((track: Track, level?: string) => {
    window.open(`/api/download-file?id=${track.id}&level=${level ?? "exhigh"}`, "_blank");
  }, []);

  const downloadToNas = useCallback(
    async (track: Track, path?: string, level?: string) => {
      try {
        const res = await rpc.api.download.$post({
          json: {
            id: track.id,
            level: level ?? "exhigh",
            ...(path !== undefined && path.trim() !== "" ? { path: path.trim() } : {}),
          },
        });
        const data = (await res.json()) as { filePath?: string; error?: string };
        if (data.error !== undefined) {
          showToast(`下载失败 ${data.error}`);
        } else {
          showToast("已开始下载到 NAS");
        }
      } catch {
        showToast("下载失败");
      }
    },
    [showToast],
  );

  const downloadBatch = useCallback(
    async (tracks: Track[], path?: string, level?: string) => {
      try {
        const res = await rpc.api["download-batch"].$post({
          json: {
            ids: tracks.map((t) => t.id),
            level: level ?? "exhigh",
            ...(path !== undefined && path.trim() !== "" ? { path: path.trim() } : {}),
          },
        });
        const data = (await res.json()) as { taskId?: string; error?: string };
        if (data.error !== undefined || data.taskId === undefined) {
          showToast("批量下载失败");
          return;
        }
        const taskId = data.taskId;
        setBatchProgress({ total: tracks.length, done: 0, status: "running" });
        // 递归 setTimeout 轮询，避免重叠；timer 存 ref 供卸载清理。
        const poll = async () => {
          try {
            const pr = await rpc.api["download-batch"].$get({ query: { id: taskId } });
            const p = (await pr.json()) as { total?: number; done?: number; status?: string };
            if (p.status === "done") {
              batchTimerRef.current = null;
              setBatchProgress({ total: p.total ?? tracks.length, done: p.done ?? tracks.length, status: "done" });
              setDownloadedVersion((v) => v + 1);
              showToast(`已下载 ${p.total ?? 0} 首到 NAS`);
              window.setTimeout(() => setBatchProgress(null), 3000);
            } else if (p.status === "error") {
              batchTimerRef.current = null;
              setBatchProgress(null);
              showToast("批量下载失败");
            } else {
              setBatchProgress({ total: p.total ?? tracks.length, done: p.done ?? 0, status: "running" });
              batchTimerRef.current = window.setTimeout(poll, 1500);
            }
          } catch {
            batchTimerRef.current = null;
            setBatchProgress(null);
            showToast("下载进度查询失败");
          }
        };
        batchTimerRef.current = window.setTimeout(poll, 1500);
      } catch {
        showToast("批量下载失败");
      }
    },
    [showToast],
  );

  const openDownloadHistory = useCallback(async () => {
    setShowDownloadHistory(true);
    setDownloadRecords([]);
    try {
      const res = await rpc.api["download-history"].$get();
      const data = (await res.json()) as {
        records?: Array<{ id: string; filename: string; filePath: string; status: string; time: string }>;
      };
      setDownloadRecords(data.records ?? []);
    } catch {
      // 忽略。
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await rpc.api.logout.$post();
      showToast("已退出登录");
      await refresh();
    } catch {
      showToast("退出失败");
    }
  }, [refresh, showToast]);

  const deletePlaylist = useCallback(
    async (id: string) => {
      try {
        await rpc.api.playlist.delete.$post({ json: { id } });
        showToast("已删除歌单");
        setDetail(null);
        await refresh();
      } catch {
        showToast("删除失败");
      }
    },
    [refresh, showToast],
  );

  const renamePlaylist = useCallback(
    async (id: string, name: string) => {
      try {
        await rpc.api.playlist.update.$post({ json: { id, name } });
        showToast("已重命名");
        await refresh();
      } catch {
        showToast("重命名失败");
      }
    },
    [refresh, showToast],
  );

  const clearDownloadHistory = useCallback(async () => {
    try {
      await rpc.api["download-history"].clear.$post();
      setDownloadRecords([]);
      showToast("已清空下载历史");
    } catch {
      showToast("清空失败");
    }
  }, [showToast]);

  const addToPlaylist = useCallback(
    async (trackId: string, playlistId: string) => {
      try {
        await rpc.api.playlist.add.$post({ json: { playlistId, trackIds: [trackId] } });
        showToast("已加入歌单");
      } catch {
        showToast("添加失败");
      }
    },
    [showToast],
  );

  const dismissLast = useCallback(() => {
    setLastTrack(null);
    try {
      localStorage.removeItem("last-track");
      localStorage.removeItem("last-position");
    } catch {
      // 忽略。
    }
  }, []);

  const reorderQueue = useCallback((from: number, to: number) => {
    setQueue((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved !== undefined) next.splice(to, 0, moved);
      return next;
    });
    setQueueIndex((idx) => {
      if (idx === from) return to;
      if (from < idx && to >= idx) return idx - 1;
      if (from > idx && to <= idx) return idx + 1;
      return idx;
    });
  }, []);

  const removeFromQueue = useCallback(
    (index: number) => {
      const newQueue = queue.filter((_, i) => i !== index);
      let newIndex = queueIndex;
      if (index === queueIndex) {
        newIndex = Math.min(index, Math.max(0, newQueue.length - 1));
      } else if (index < queueIndex) {
        newIndex = queueIndex - 1;
      }
      setQueue(newQueue);
      setQueueIndex(newIndex);

      // 移除的是当前播放项：同步 currentTrack 并续播新当前项（或停止）。
      if (index === queueIndex) {
        const nextTrack = newQueue[newIndex] ?? null;
        if (nextTrack !== null) {
          void playAt(newQueue, newIndex);
        } else {
          setCurrentTrack(null);
          const audio = audioRef.current;
          if (audio !== null) {
            audio.pause();
            audio.removeAttribute("src");
          }
        }
      }
    },
    [queue, queueIndex, playAt],
  );

  const toggleLike = useCallback(
    async (track: Track, liked: boolean) => {
      try {
        if (liked) {
          await rpc.api.unlike.$post({ query: { id: track.id } });
          showToast("已取消红心");
        } else {
          await rpc.api.like.$post({ query: { id: track.id } });
          showToast("已添加红心");
        }
        // 成功后同步全局红心集合 + 播放栏当前曲目红心态。
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (liked) next.delete(track.id);
          else next.add(track.id);
          return next;
        });
        setLikedCurrent((prev) => {
          const isCurrent = currentTrack?.id === track.id;
          return isCurrent ? !liked : prev;
        });
      } catch {
        showToast("操作失败");
      }
    },
    [showToast, currentTrack],
  );

  const resumePlay = useCallback(async () => {
    if (lastTrack === null) return;
    let pos = 0;
    try {
      pos = Number(localStorage.getItem("last-position")) || 0;
    } catch {
      // 忽略。
    }
    pendingSeek.current = pos;
    await playAt([lastTrack], 0);
  }, [lastTrack, playAt]);

  const openLyrics = useCallback(async (track: Track) => {
    setShowLyrics(true);
    setLyricLines([]);
    try {
      const res = await rpc.api.lyric.$get({ query: { id: track.id } });
      const data = (await res.json()) as { original?: string; translated?: string; error?: string };
      setLyricLines(mergeLyrics(data.original, data.translated));
    } catch {
      setLyricLines([]);
      showToast("获取歌词失败");
    }
  }, [showToast]);

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
      } else if (e.code === "KeyM") {
        toggleMute();
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        void playPrev();
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        void playNext();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, toggleMute, playPrev, playNext]);

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

      {fetching > 0 ? (
        <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20">
          <div className="h-full w-1/3 animate-progress bg-primary" />
        </div>
      ) : null}

      <div className={cn("flex min-h-0 flex-1 flex-col", currentTrack !== null && "pb-24")}>
        {detailLoading ? (
          <PlaylistSkeleton />
        ) : detail !== null ? (
          <PlaylistView
            detail={detail}
            {...(currentTrack !== null ? { currentTrackId: currentTrack.id } : {})}
            onBack={() => setDetail(null)}
            onPlay={(t, i) => void playAt(detail.tracks, i)}
            onPlayAll={() => void playAt(detail.tracks, 0)}
            onToggleLike={toggleLike}
            onSharePlaylist={(id) => void sharePlaylist(id)}
            onShowDetail={setSongDetail}
            onDownloadLocal={(t) => setDownloadTarget(t)}
            onDownloadAll={(path, level) => void downloadBatch(detail.tracks, path, level)}
            onDeletePlaylist={(id) => void deletePlaylist(id)}
            onRenamePlaylist={(id, name) => void renamePlaylist(id, name)}
            downloadedVersion={downloadedVersion}
          />
        ) : account === null ? (
          <HomeSkeleton />
        ) : account.loggedIn ? (
          <HomeView
            account={account}
            recentTracks={recentTracks}
            lastTrack={lastTrack}
            playCounts={playCounts}
            onResume={() => void resumePlay()}
            avatarError={avatarError}
            onAvatarError={() => setAvatarError(true)}
            onOpenPlaylist={(id) => void openPlaylist(id)}
            onPlayPlaylist={(id) => void playPlaylist(id)}
            onPlaySong={(t) => void playAt([t], 0)}
            onRefresh={() => void refresh()}
            onShowHistory={() => setShowHistory(true)}
            onDownloadLocal={(t) => setDownloadTarget(t)}
            onLogout={() => void logout()}
            onDismissLast={dismissLast}
            onToggleLike={toggleLike}
            likedIds={likedIds}
            recommend={recommend}
            recommendPlaylists={recommendPlaylists}
            onPlayPersonalFm={() => void playPersonalFm()}
            onOpenDownloadHistory={() => void openDownloadHistory()}
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
          if (a.currentTime - lastPosSave.current > 3) {
            lastPosSave.current = a.currentTime;
            try {
              localStorage.setItem("last-position", String(a.currentTime));
            } catch {
              // 忽略。
            }
          }
        }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          if (pendingSeek.current !== null) {
            e.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
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
        shuffle={shuffle}
        onToggleShuffle={() => setShuffle((v) => !v)}
        volume={volume}
        muted={muted}
        level={level}
        rate={rate}
        sleepMinutes={sleepMinutes}
        onTogglePlay={togglePlay}
        onPrev={() => void playPrev()}
        onNext={() => void playNext()}
        onToggleRepeat={toggleRepeat}
        onSeek={seek}
        onToggleMute={toggleMute}
        onVolumeChange={changeVolume}
        onOpenLyrics={(t) => void openLyrics(t)}
        onShowDetail={setSongDetail}
        onOpenQueue={() => setShowQueue(true)}
        onShare={(t) => void shareTrack(t)}
        onCycleRate={cycleRate}
        onCycleSleep={cycleSleep}
        liked={likedCurrent}
        onToggleLikeCurrent={() => {
          if (currentTrack === null) return;
          void toggleLike(currentTrack, likedCurrent);
          setLikedCurrent((v) => !v);
        }}
        onCycleLevel={() => void changeLevel()}
        onDownload={() => {
          if (currentTrack !== null) setDownloadTarget(currentTrack);
        }}
        onOpenDownloadHistory={() => void openDownloadHistory()}
      />

      {showLyrics && currentTrack !== null ? (
        <LyricsView
          track={currentTrack}
          lines={lyricLines}
          currentTime={currentTime}
          onSeekTime={(time) => {
            const audio = audioRef.current;
            if (audio !== null) audio.currentTime = time;
          }}
          onDownload={() => setDownloadTarget(currentTrack)}
          onClose={() => setShowLyrics(false)}
        />
      ) : null}

      {showQueue ? (
        <QueuePanel
          queue={queue}
          currentIndex={queueIndex}
          onPlay={(i) => void playAt(queue, i)}
          onReorder={reorderQueue}
          onRemove={removeFromQueue}
          onClose={() => setShowQueue(false)}
        />
      ) : null}

      {toast !== null ? (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 animate-fade-in rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}

      {batchProgress !== null ? (
        <div className="fixed left-1/2 top-16 z-40 w-64 -translate-x-1/2 rounded-2xl border bg-card p-4 shadow-lg">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">批量下载</span>
            <span className="tabular-nums text-muted-foreground">
              {batchProgress.done}/{batchProgress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{
                width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {batchProgress.status === "done" ? "已完成" : "下载中…"}
          </p>
        </div>
      ) : null}

      {showHelp ? <HelpPanel onClose={() => setShowHelp(false)} /> : null}

      {songDetail !== null ? (
        <SongDetailModal
          track={songDetail}
          onPlay={() => {
            void playAt([songDetail], 0);
            setSongDetail(null);
          }}
          liked={likedIds.has(songDetail.id)}
          onToggleLike={() => {
            void toggleLike(songDetail, likedIds.has(songDetail.id));
          }}
          onShare={() => void shareTrack(songDetail)}
          onLyrics={() => {
            void openLyrics(songDetail);
            setSongDetail(null);
          }}
          onDownload={() => {
            setDownloadTarget(songDetail);
            setSongDetail(null);
          }}
          playlists={account?.playlists ?? []}
          onAddToPlaylist={(playlistId) => void addToPlaylist(songDetail.id, playlistId)}
          onClose={() => setSongDetail(null)}
        />
      ) : null}

      {downloadTarget !== null ? (
        <DownloadDialog
          track={downloadTarget}
          onDownloadLocal={(level) => downloadToLocal(downloadTarget, level)}
          onDownloadNas={(path, level) => void downloadToNas(downloadTarget, path, level)}
          onClose={() => setDownloadTarget(null)}
        />
      ) : null}

      {showHistory ? (
        <HistoryPanel
          tracks={recentTracks}
          onPlay={(t) => {
            void playAt([t], 0);
            setShowHistory(false);
          }}
          onDownload={(t) => setDownloadTarget(t)}
          onToggleLike={(t) => void toggleLike(t, likedIds.has(t.id))}
          likedIds={likedIds}
          onClear={clearRecent}
          onClose={() => setShowHistory(false)}
        />
      ) : null}

      {showDownloadHistory ? (
        <DownloadHistoryPanel
          records={downloadRecords}
          onClear={() => void clearDownloadHistory()}
          onClose={() => setShowDownloadHistory(false)}
        />
      ) : null}
    </div>
  );
}

function DownloadHistoryPanel(props: {
  records: Array<{ id: string; filename: string; filePath: string; status: string; time: string }>;
  onClear: () => void;
  onClose: () => void;
}) {
  const { records, onClear, onClose } = props;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-slide-up rounded-t-2xl bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">下载历史（{records.length}）</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onClear}
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

function HistoryPanel(props: {
  tracks: Track[];
  onPlay: (t: Track) => void;
  onDownload: (t: Track) => void;
  onToggleLike: (t: Track) => void;
  likedIds: Set<string>;
  onClear: () => void;
  onClose: () => void;
}) {
  const { tracks, onPlay, onDownload, onToggleLike, likedIds, onClear, onClose } = props;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-slide-up rounded-t-2xl bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">播放历史（{tracks.length}）</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onClear}
              className="rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              清除
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
          {tracks.map((t) => (
            <li key={t.id} className="flex items-center">
              <button onClick={() => onPlay(t)} className="flex flex-1 items-center gap-3 py-2.5 text-left">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-muted">
                  {t.coverUrl ? (
                    <img src={t.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center"
                      style={{ background: coverGradient(t.title) }}
                    >
                      <ListMusic className="h-4 w-4 text-white/70" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.artists?.join(" / ")}</p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatDuration(t.durationMs)}
                </span>
              </button>
              <button
                onClick={() => onToggleLike(t)}
                className={cn(
                  "shrink-0 rounded-full p-2 transition-colors",
                  likedIds.has(t.id) ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                title={likedIds.has(t.id) ? "取消红心" : "红心收藏"}
              >
                <Heart className={cn("h-4 w-4", likedIds.has(t.id) && "fill-primary")} />
              </button>
              <button
                onClick={() => onDownload(t)}
                className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
                title="下载"
              >
                <Download className="h-4 w-4" />
              </button>
            </li>
          ))}
          {tracks.length === 0 ? (
            <li className="py-10 text-center text-sm text-muted-foreground">暂无播放历史</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function FolderPicker(props: {
  value: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const { value, onSelect, onClose } = props;
  const [current, setCurrent] = useState(value);
  const [dirs, setDirs] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await rpc.api["download-dirs"].$get({ query: { path: current } });
        const data = (await res.json()) as { dirs?: string[] };
        if (!cancelled && data.dirs !== undefined) setDirs(data.dirs);
      } catch {
        // 忽略。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current]);

  const enter = (name: string) => setCurrent(current === "" ? name : `${current}/${name}`);
  const goUp = () =>
    setCurrent(current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "");

  const createFolder = async () => {
    if (newName.trim() === "") return;
    try {
      await rpc.api["download-mkdir"].$post({ json: { path: current, name: newName.trim() } });
      setNewName("");
      setCreating(false);
      const res = await rpc.api["download-dirs"].$get({ query: { path: current } });
      const data = (await res.json()) as { dirs?: string[] };
      if (data.dirs !== undefined) setDirs(data.dirs);
    } catch {
      // 忽略。
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">选择文件夹</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
          <button
            onClick={goUp}
            className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
            title="返回上级"
            disabled={current === ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">/{current || "根目录"}</span>
        </div>

        <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border">
          {dirs.map((d) => (
            <button
              key={d}
              onClick={() => enter(d)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{d}</span>
            </button>
          ))}
          {dirs.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">空文件夹</p>
          ) : null}
        </div>

        {creating ? (
          <div className="mb-3 flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="文件夹名"
              className="rounded-full text-xs"
              autoFocus
            />
            <Button size="sm" className="shrink-0 rounded-full" onClick={createFolder}>
              创建
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="mb-3 flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            <FolderPlus className="h-4 w-4" />
            新建文件夹
          </button>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1 rounded-full" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" className="flex-1 rounded-full" onClick={() => onSelect(current)}>
            选择此文件夹
          </Button>
        </div>
      </div>
    </div>
  );
}

function DownloadDialog(props: {
  track: Track;
  onDownloadLocal: (level: string) => void;
  onDownloadNas: (path: string, level: string) => void;
  onClose: () => void;
}) {
  const { track, onDownloadLocal, onDownloadNas, onClose } = props;
  const [level, setLevel] = useState("exhigh");
  const [channel, setChannel] = useState<"local" | "nas">("local");
  const [nasPath, setNasPath] = useState("");
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const levels: Array<{ value: string; label: string }> = [
    { value: "exhigh", label: "320k MP3" },
    { value: "lossless", label: "无损 FLAC" },
    { value: "higher", label: "192k MP3" },
    { value: "standard", label: "128k MP3" },
  ];
  const levelLabel = levels.find((l) => l.value === level)?.label ?? level;

  const confirm = () => {
    if (channel === "local") onDownloadLocal(level);
    else onDownloadNas(nasPath, level);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center" style={{ background: coverGradient(track.title) }}>
                <ListMusic className="h-6 w-6 text-white/70" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{track.title}</p>
            <p className="truncate text-sm text-muted-foreground">{track.artists?.join(" / ")}</p>
          </div>
        </div>

        <div className="mb-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">音质</span>
            <button
              onClick={() =>
                setLevel((l) => {
                  const idx = levels.findIndex((x) => x.value === l);
                  return levels[(idx + 1) % levels.length]?.value ?? l;
                })
              }
              className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
            >
              {levelLabel}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">下载到</span>
            <div className="flex gap-1 rounded-full bg-muted p-1">
              <button
                onClick={() => setChannel("local")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  channel === "local" ? "bg-background text-foreground shadow" : "text-muted-foreground",
                )}
              >
                本机
              </button>
              <button
                onClick={() => setChannel("nas")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  channel === "nas" ? "bg-background text-foreground shadow" : "text-muted-foreground",
                )}
              >
                NAS
              </button>
            </div>
          </div>
          {channel === "nas" ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground">目录</span>
              <button
                onClick={() => setFolderPickerOpen(true)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">/{nasPath || "根目录"}</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1 rounded-full" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" className="flex-1 rounded-full" onClick={confirm}>
            <Download />
            下载
          </Button>
        </div>
      </div>

      {folderPickerOpen ? (
        <FolderPicker
          value={nasPath}
          onSelect={(path) => {
            setNasPath(path);
            setFolderPickerOpen(false);
          }}
          onClose={() => setFolderPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SongDetailModal(props: {
  track: Track;
  onPlay: () => void;
  liked: boolean;
  onToggleLike: () => void;
  onShare: () => void;
  onLyrics: () => void;
  onDownload: () => void;
  playlists: PlaylistSummary[];
  onAddToPlaylist: (playlistId: string) => void;
  onClose: () => void;
}) {
  const { track, onPlay, liked, onToggleLike, onShare, onLyrics, onDownload, playlists, onAddToPlaylist, onClose } =
    props;
  const [playlistOpen, setPlaylistOpen] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="h-40 w-40 overflow-hidden rounded-xl shadow-md">
            {track.coverUrl ? (
              <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center"
                style={{ background: coverGradient(track.title) }}
              >
                <ListMusic className="h-12 w-12 text-white/70" />
              </div>
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold">{track.title}</h2>
            <p className="text-sm text-muted-foreground">{track.artists?.join(" / ")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {track.album ? `${track.album} · ` : ""}
              {formatDuration(track.durationMs)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex justify-center gap-2">
            <Button size="sm" className="rounded-full" onClick={onPlay}>
              <Play />
              播放
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={onToggleLike}
            >
              <Heart className={cn("h-4 w-4", liked && "fill-primary text-primary")} />
              {liked ? "取消红心" : "红心"}
            </Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={onShare}>
              <Share />
              分享
            </Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={onLyrics}>
              <TextQuote />
              歌词
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setPlaylistOpen((v) => !v)}
            >
              <ListPlus />
              加入歌单
            </Button>
          </div>
          {playlistOpen ? (
            <div className="max-h-40 w-full overflow-y-auto rounded-xl border p-1.5">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onAddToPlaylist(p.id);
                    setPlaylistOpen(false);
                  }}
                  className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {p.name}
                </button>
              ))}
              {playlists.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">暂无歌单</p>
              ) : null}
            </div>
          ) : null}
          <Button size="sm" variant="outline" className="rounded-full" onClick={onDownload}>
            <Download />
            下载
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="mt-4 w-full rounded-full" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}

function PlaylistSkeleton() {
  return (
    <div className="flex-1 animate-pulse overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-6 h-8 w-20 rounded-full bg-muted" />
        <div className="mb-8 flex gap-6">
          <div className="h-40 w-40 shrink-0 rounded-2xl bg-muted sm:h-44 sm:w-44" />
          <div className="flex-1">
            <div className="h-4 w-10 rounded bg-muted" />
            <div className="mt-2 h-8 w-48 rounded bg-muted" />
            <div className="mt-2 h-4 w-24 rounded bg-muted" />
          </div>
        </div>
        <div className="space-y-2 rounded-2xl bg-card p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HelpPanel(props: { onClose: () => void }) {
  const { onClose } = props;
  const shortcuts: Array<[string, string]> = [
    ["空格", "播放 / 暂停"],
    ["← / →", "快退 / 快进 5 秒"],
    ["M", "静音 / 取消静音"],
    ["?", "显示 / 隐藏此帮助"],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">键盘快捷键</h2>
        <ul className="divide-y divide-border/60">
          {shortcuts.map(([key, desc]) => (
            <li key={key} className="flex items-center justify-between py-2.5">
              <kbd className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{key}</kbd>
              <span className="text-sm text-muted-foreground">{desc}</span>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="mt-4 w-full rounded-full" onClick={onClose}>
          关闭
        </Button>
      </div>
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
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
}) {
  const { queue, currentIndex, onPlay, onReorder, onRemove, onClose } = props;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
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
              <li
                key={t.id}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-center"
              >
                <button
                  onClick={() => onPlay(i)}
                  className={cn("flex flex-1 items-center gap-3 py-2.5 text-left", isCurrent && "text-primary")}
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
                <button
                  onClick={() => onRemove(i)}
                  className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-destructive"
                  title="从队列移除"
                >
                  <X className="h-4 w-4" />
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
  recentTracks: Track[];
  lastTrack: Track | null;
  playCounts: Record<string, number>;
  onResume: () => void;
  avatarError: boolean;
  onAvatarError: () => void;
  onOpenPlaylist: (id: string) => void;
  onPlayPlaylist: (id: string) => void;
  onPlaySong: (track: Track) => void;
  onRefresh: () => void;
  onShowHistory: () => void;
  onDownloadLocal: (track: Track) => void;
  onLogout: () => void;
  onDismissLast: () => void;
  onToggleLike: (track: Track, liked: boolean) => void;
  likedIds: Set<string>;
  recommend: Track[];
  recommendPlaylists: Array<{ id: string; name: string; coverUrl?: string; playCount: number }>;
  onPlayPersonalFm: () => void;
  onOpenDownloadHistory: () => void;
}) {
  const { account, recentTracks, lastTrack, playCounts, onResume, avatarError, onAvatarError, onOpenPlaylist, onPlayPlaylist, onPlaySong, onRefresh, onShowHistory, onDownloadLocal, onLogout, onDismissLast, onToggleLike, likedIds, recommend, recommendPlaylists, onPlayPersonalFm, onOpenDownloadHistory } =
    props;
  const [search, setSearch] = useState("");
  const [songQuery, setSongQuery] = useState("");
  const [songResults, setSongResults] = useState<Track[]>([]);
  const [sortMode, setSortMode] = useState<"default" | "name" | "count">("default");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("search-history");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [searchFocused, setSearchFocused] = useState(false);
  const nickname = account.account?.nickname ?? "网易云用户";
  const avatarUrl = account.account?.avatarUrl;
  const vip = account.vip;
  const playlists = account.playlists ?? [];
  const liked = playlists.find((p) => p.specialType === 5);
  const others = playlists.filter((p) => p.specialType !== 5);
  const base =
    search.trim() === ""
      ? others
      : playlists.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const filtered =
    sortMode === "name"
      ? [...base].sort((a, b) => a.name.localeCompare(b.name, "zh"))
      : sortMode === "count"
        ? [...base].sort((a, b) => b.trackCount - a.trackCount)
        : base;
  const mostPlayed = [...recentTracks]
    .sort((a, b) => (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0))
    .filter((t) => (playCounts[t.id] ?? 0) > 0)
    .slice(0, 5);

  useEffect(() => {
    if (songQuery.trim() === "") {
      setSongResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await rpc.api.search.$get({ query: { q: songQuery } });
        const data = (await res.json()) as { songs?: Track[] };
        if (cancelled) return;
        setSongResults(data.songs ?? []);
        setHistory((prev) => {
          const q = songQuery.trim();
          const next = [q, ...prev.filter((h) => h !== q)].slice(0, 10);
          try {
            localStorage.setItem("search-history", JSON.stringify(next));
          } catch {
            // 忽略。
          }
          return next;
        });
      } catch {
        if (!cancelled) setSongResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [songQuery]);

  const doCreate = async () => {
    const name = newName.trim();
    if (name === "") return;
    try {
      await rpc.api.playlist.create.$post({ json: { name } });
      setNewName("");
      setCreating(false);
      onRefresh();
    } catch {
      // 忽略创建失败。
    }
  };

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
            <button
              onClick={onLogout}
              className="ml-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="退出登录"
            >
              退出登录
            </button>
            <button
              onClick={onOpenDownloadHistory}
              className="ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="下载列表"
            >
              <Clock className="h-3.5 w-3.5" />
              下载列表
            </button>
          </div>
          {account.account?.signature ? (
            <p className="mt-2 text-muted-foreground">{account.account.signature}</p>
          ) : null}
        </div>

        {lastTrack !== null ? (
          <div className="group relative mb-6">
            <button
              onClick={onResume}
              className="flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-primary/15 to-transparent p-4 text-left transition-shadow hover:shadow-md sm:gap-5 sm:p-5"
            >
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted shadow-sm">
                {lastTrack.coverUrl ? (
                  <img src={lastTrack.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ListMusic className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Play className="h-4 w-4 fill-primary" />
                  继续播放
                </p>
                <p className="mt-1 truncate text-xl font-bold">{lastTrack.title}</p>
                <p className="truncate text-sm text-muted-foreground">{lastTrack.artists?.join(" / ")}</p>
              </div>
            </button>
            <button
              onClick={onDismissLast}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {recentTracks.length > 0 ? (
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold">最近播放</h2>
              <button
                onClick={onShowHistory}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                查看全部
              </button>
            </div>
            <div className="flex gap-4 no-scrollbar overflow-x-auto pb-2">
              {recentTracks.map((t) => (
                <button key={t.id} onClick={() => onPlaySong(t)} className="w-36 shrink-0 text-left">
                  <div className="aspect-square w-full overflow-hidden rounded-xl bg-muted shadow-sm">
                    {t.coverUrl ? (
                      <img src={t.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ListMusic className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.artists?.join(" / ")}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {mostPlayed.length > 0 ? (
          <div className="mb-8">
            <h2 className="mb-4 text-2xl font-bold">最常播放</h2>
            <div className="flex gap-4 no-scrollbar overflow-x-auto pb-2">
              {mostPlayed.map((t) => (
                <button key={t.id} onClick={() => onPlaySong(t)} className="w-36 shrink-0 text-left">
                  <div className="aspect-square w-full overflow-hidden rounded-xl bg-muted shadow-sm">
                    {t.coverUrl ? (
                      <img src={t.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ background: coverGradient(t.title) }}
                      >
                        <ListMusic className="h-8 w-8 text-white/70" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{playCounts[t.id] ?? 0} 次播放</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

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
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 200)}
              placeholder="搜索歌曲（网易云）"
              className="rounded-full pl-9"
            />
            {searchFocused && history.length > 0 && songQuery.trim() === "" ? (
              <div className="absolute z-10 mt-2 w-full rounded-xl border bg-card p-2 shadow-lg">
                {history.map((h) => (
                  <button
                    key={h}
                    onMouseDown={() => setSongQuery(h)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {h}
                  </button>
                ))}
                <div className="my-1 h-px bg-border" />
                <button
                  onMouseDown={() => {
                    setHistory([]);
                    try {
                      localStorage.removeItem("search-history");
                    } catch {
                      // 忽略。
                    }
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
                >
                  清除搜索历史
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {songQuery.trim() !== "" ? (
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
            <ul className="divide-y divide-border/60">
              {songResults.map((t, i) => (
                <li key={t.id} className="flex items-center">
                  <button
                    onClick={() => onPlaySong(t)}
                    className="flex flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 sm:gap-4 sm:px-4"
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
                  <button
                    onClick={() => onToggleLike(t, likedIds.has(t.id))}
                    className={cn(
                      "shrink-0 rounded-full p-2 transition-colors",
                      likedIds.has(t.id) ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                    title={likedIds.has(t.id) ? "取消红心" : "红心收藏"}
                  >
                    <Heart className={cn("h-4 w-4", likedIds.has(t.id) && "fill-primary")} />
                  </button>
                  <button
                    onClick={() => onDownloadLocal(t)}
                    className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
                    title="下载"
                  >
                    <Download className="h-4 w-4" />
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
            {recommend.length > 0 && search.trim() === "" ? (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2.5">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold">每日推荐</h2>
                  <button
                    onClick={onPlayPersonalFm}
                    className="ml-auto rounded-full px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    title="私人 FM（每日电台）"
                  >
                    ▶ 每日电台
                  </button>
                </div>
                <div className="flex gap-3 no-scrollbar overflow-x-auto pb-2">
                  {recommend.map((t) => (
                    <button key={t.id} onClick={() => onPlaySong(t)} className="w-32 shrink-0 text-left">
                      <div className="aspect-square w-full overflow-hidden rounded-xl bg-muted">
                        {t.coverUrl ? (
                          <img src={t.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center" style={{ background: coverGradient(t.title) }}>
                            <ListMusic className="h-8 w-8 text-white/70" />
                          </div>
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm font-medium">{t.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.artists?.join(" / ")}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {recommendPlaylists.length > 0 && search.trim() === "" ? (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2.5">
                  <Flame className="h-5 w-5 text-primary" />
                  <h2 className="text-2xl font-bold">推荐歌单</h2>
                </div>
                <div className="flex gap-3 no-scrollbar overflow-x-auto pb-2">
                  {recommendPlaylists.map((p) => (
                    <button key={p.id} onClick={() => onOpenPlaylist(p.id)} className="w-32 shrink-0 text-left">
                      <div className="aspect-square w-full overflow-hidden rounded-xl bg-muted">
                        {p.coverUrl ? (
                          <img src={p.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center" style={{ background: coverGradient(p.name) }}>
                            <ListMusic className="h-8 w-8 text-white/70" />
                          </div>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{formatCount(p.playCount)}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mb-5 flex flex-wrap items-center gap-2.5">
              <ListMusic className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-bold">
                {search.trim() === "" ? "歌单" : `搜索结果（${filtered.length}）`}
              </h2>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() =>
                    setSortMode((m) => (m === "default" ? "name" : m === "name" ? "count" : "default"))
                  }
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {sortMode === "name" ? "按名称" : sortMode === "count" ? "按歌曲数" : "默认排序"}
                </button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setCreating((v) => !v)}>
                  <Plus />
                  新建歌单
                </Button>
              </div>
            </div>

            {creating ? (
              <div className="mb-6 flex max-w-sm gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="歌单名称"
                  className="rounded-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doCreate();
                  }}
                />
                <Button size="sm" className="rounded-full" onClick={() => void doCreate()}>
                  创建
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-5 sm:gap-y-7 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {filtered.map((p) => (
                <button key={p.id} onClick={() => onOpenPlaylist(p.id)} className="group text-left">
                  <Tilt className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted shadow-sm transition-shadow duration-300 group-hover:shadow-xl">
                    {p.coverUrl ? (
                      <img
                        src={p.coverUrl}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ background: coverGradient(p.name) }}
                      >
                        <ListMusic className="h-10 w-10 text-white/70" />
                      </div>
                    )}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayPlaylist(p.id);
                      }}
                      className="absolute inset-0 hidden items-center justify-center gap-3 bg-black/30 group-hover:flex"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-primary shadow-lg">
                        <Play className="ml-0.5 h-5 w-5" />
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPlaylist(p.id);
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-foreground shadow-lg"
                        title="查看详情 / 下载"
                      >
                        <Download className="h-4 w-4" />
                      </span>
                    </span>
                  </Tilt>
                  <p className="mt-2.5 truncate text-base font-medium">{p.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.trackCount} 首</p>
                </button>
              ))}
              {filtered.length === 0 ? (
                <div className="col-span-full flex flex-col items-center gap-3 py-16 text-center">
                  <ListMusic className="h-12 w-12 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {search.trim() !== "" ? "没有匹配的歌单" : "还没有歌单，点击「新建歌单」创建"}
                  </p>
                </div>
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
  onToggleLike: (track: Track, liked: boolean) => void;
  onSharePlaylist: (id: string) => void;
  onShowDetail: (track: Track) => void;
  onDownloadLocal: (track: Track) => void;
  onDownloadAll: (path: string, level: string) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  downloadedVersion: number;
}) {
  const { detail, currentTrackId, onBack, onPlay, onPlayAll, onToggleLike, onSharePlaylist, onShowDetail, onDownloadLocal, onDownloadAll, onDeletePlaylist, onRenamePlaylist, downloadedVersion } =
    props;
  const [hearted, setHearted] = useState<Set<string>>(new Set());
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchPath, setBatchPath] = useState("");
  const [batchLevel, setBatchLevel] = useState("exhigh");
  const [batchFolderOpen, setBatchFolderOpen] = useState(false);

  // 加载时查询哪些歌已下载、哪些已红心。
  useEffect(() => {
    const ids = detail.tracks.map((t) => t.id);
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await rpc.api.downloaded.$get({ query: { ids: ids.join(",") } });
        const data = (await res.json()) as { downloaded?: string[] };
        if (!cancelled && data.downloaded !== undefined) {
          setDownloaded(new Set(data.downloaded));
        }
      } catch {
        // 忽略。
      }
      try {
        const res = await rpc.api.liked.$get();
        const data = (await res.json()) as { ids?: string[] };
        if (!cancelled && data.ids !== undefined) {
          setHearted(new Set(data.ids));
        }
      } catch {
        // 忽略。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.tracks, downloadedVersion]);

  const toggleHeart = (t: Track) => {
    const liked = hearted.has(t.id);
    void onToggleLike(t, liked);
    setHearted((prev) => {
      const next = new Set(prev);
      if (liked) next.delete(t.id);
      else next.add(t.id);
      return next;
    });
  };

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
            <div className="flex items-center gap-2">
              <h1 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">{detail.title}</h1>
              <button
                onClick={() => onSharePlaylist(detail.id)}
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                title="分享歌单"
              >
                <Share className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  const name = window.prompt("重命名歌单", detail.title);
                  if (name !== null && name.trim() !== "" && name.trim() !== detail.title) {
                    onRenamePlaylist(detail.id, name.trim());
                  }
                }}
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                title="重命名歌单"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`确定删除歌单「${detail.title}」？`)) {
                    onDeletePlaylist(detail.id);
                  }
                }}
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                title="删除歌单"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {detail.tracks.length} 首歌曲
              {(() => {
                const totalMs = detail.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
                if (totalMs <= 0) return "";
                const totalMin = Math.round(totalMs / 60000);
                const label =
                  totalMin >= 60 ? `约 ${Math.floor(totalMin / 60)} 小时 ${totalMin % 60} 分钟` : `约 ${totalMin} 分钟`;
                return ` · ${label}`;
              })()}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full" onClick={onPlayAll}>
                <Play className="mr-1 h-4 w-4" />
                播放全部
              </Button>
              {batchOpen ? (
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    onClick={() =>
                      setBatchLevel((l) => {
                        const levels = ["exhigh", "lossless", "higher", "standard"];
                        const idx = levels.indexOf(l);
                        return levels[(idx + 1) % levels.length] ?? l;
                      })
                    }
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
                    title="切换品质"
                  >
                    品质：{batchLevel}
                  </button>
                  <button
                    onClick={() => setBatchFolderOpen(true)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">/{batchPath || "根目录"}</span>
                  </button>
                  <Button
                    size="sm"
                    className="shrink-0 rounded-full"
                    onClick={() => {
                      onDownloadAll(batchPath, batchLevel);
                      setBatchOpen(false);
                    }}
                  >
                    确认
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setBatchOpen(true)}>
                  <HardDriveDownload className="mr-1 h-4 w-4" />
                  下载全部
                </Button>
              )}
            </div>
          </div>
        </div>

        {batchFolderOpen ? (
          <FolderPicker
            value={batchPath}
            onSelect={(path) => {
              setBatchPath(path);
              setBatchFolderOpen(false);
            }}
            onClose={() => setBatchFolderOpen(false)}
          />
        ) : null}

        <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
          <ul className="divide-y divide-border/60">
            {detail.tracks.map((t, i) => {
              const isCurrent = t.id === currentTrackId;
              return (
                <li key={t.id} className="flex items-center">
                  <button
                    onClick={() => onPlay(t, i)}
                    className={cn(
                      "flex flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 sm:gap-4 sm:px-4",
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
                    {downloaded.has(t.id) ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : null}
                  </button>
                  <button
                    onClick={() => toggleHeart(t)}
                    className={cn(
                      "shrink-0 rounded-full p-2 transition-colors",
                      hearted.has(t.id) ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                    title={hearted.has(t.id) ? "取消红心" : "红心收藏"}
                  >
                    <Heart className={cn("h-4 w-4", hearted.has(t.id) && "fill-primary")} />
                  </button>
                  <button
                    onClick={() => {
                      onDownloadLocal(t);
                      setDownloaded((prev) => {
                        const next = new Set(prev);
                        next.add(t.id);
                        return next;
                      });
                    }}
                    className={cn(
                      "shrink-0 rounded-full p-2 transition-colors",
                      downloaded.has(t.id) ? "text-emerald-500" : "text-muted-foreground hover:text-foreground",
                    )}
                    title={downloaded.has(t.id) ? "已下载（再次下载）" : "下载"}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onShowDetail(t)}
                    className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
                    title="歌曲详情"
                  >
                    <MoreHorizontal className="h-4 w-4" />
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
  shuffle: boolean;
  onToggleShuffle: () => void;
  volume: number;
  muted: boolean;
  level: string;
  rate: number;
  sleepMinutes: number | null;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleRepeat: () => void;
  onSeek: (ratio: number) => void;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
  onOpenLyrics: (track: Track) => void;
  onShowDetail: (track: Track) => void;
  onOpenQueue: () => void;
  onShare: (track: Track) => void;
  onCycleRate: () => void;
  onCycleSleep: () => void;
  liked: boolean;
  onToggleLikeCurrent: () => void;
  onCycleLevel: () => void;
  onDownload: () => void;
  onOpenDownloadHistory: () => void;
}) {
  const {
    track,
    playing,
    progress,
    duration,
    queueIndex,
    queueTotal,
    repeatMode,
    shuffle,
    onToggleShuffle,
    volume,
    muted,
    level,
    rate,
    sleepMinutes,
    onTogglePlay,
    onPrev,
    onNext,
    onToggleRepeat,
    onSeek,
    onToggleMute,
    onVolumeChange,
    onOpenLyrics,
    onShowDetail,
    onOpenQueue,
    onShare,
    onCycleRate,
    onCycleSleep,
    liked,
    onToggleLikeCurrent,
    onCycleLevel,
    onDownload,
    onOpenDownloadHistory,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  if (track === null) return null;

  const totalSec = duration > 0 ? duration : (track.durationMs !== undefined ? track.durationMs / 1000 : 0);
  const currentSec = totalSec * (progress / 100);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 animate-slide-up border-t border-border/60 bg-background/70 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2 sm:gap-4 sm:px-6 sm:py-2.5">
        <button
          onClick={() => onOpenLyrics(track)}
          onContextMenu={(e) => {
            e.preventDefault();
            onShowDetail(track);
          }}
          className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted shadow-sm sm:h-12 sm:w-12"
          title="查看歌词（右键查看详情）"
        >
          {track.coverUrl ? (
            <img
              src={track.coverUrl}
              alt=""
              className={cn("h-full w-full object-cover", playing && "animate-spin-slow")}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ListMusic className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </button>
        <button
          onClick={() => onOpenLyrics(track)}
          onContextMenu={(e) => {
            e.preventDefault();
            onShowDetail(track);
          }}
          className="min-w-0 flex-1 text-left sm:w-40 sm:flex-none"
        >
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[track.artists?.join(" / "), level].filter(Boolean).join(" · ")}
          </p>
        </button>

        <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
          <span className="text-xs tabular-nums text-foreground/70">
            {formatDuration(Math.round(currentSec) * 1000)}
          </span>
          <div
            className="group/bar relative h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full bg-border"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek((e.clientX - rect.left) / rect.width);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) {
                const rect = e.currentTarget.getBoundingClientRect();
                onSeek((e.clientX - rect.left) / rect.width);
              }
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

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={onToggleShuffle}
            className={cn(
              "rounded-full p-1.5 transition-colors",
              shuffle ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            title={shuffle ? "关闭随机播放" : "随机播放"}
            aria-label="随机播放"
          >
            <Shuffle className="h-5 w-5" />
          </button>
          <button
            onClick={onToggleRepeat}
            className={cn(
              "rounded-full p-1.5 transition-colors",
              repeatMode === "off" ? "text-muted-foreground hover:text-foreground" : "bg-primary/10 text-primary",
            )}
            title={repeatMode === "off" ? "顺序播放" : repeatMode === "all" ? "列表循环" : "单曲循环"}
          >
            {repeatMode === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
          </button>
          <button
            onClick={onPrev}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="上一首"
            aria-label="上一首"
          >
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            onClick={onTogglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow transition-transform hover:scale-105 hover:bg-primary/90"
            aria-label={playing ? "暂停" : "播放"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <button
            onClick={onNext}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title="下一首"
            aria-label="下一首"
          >
            <SkipForward className="h-5 w-5" />
          </button>
        </div>

        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <button
            onClick={onToggleMute}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            title={muted ? "取消静音" : "静音"}
            aria-label={muted ? "取消静音" : "静音"}
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

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "rounded-full p-1.5 transition-colors",
              menuOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            title="更多"
            aria-label="更多"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full right-0 z-40 mb-2 w-48 rounded-xl border bg-popover p-1.5 shadow-lg">
                <button
                  onClick={() => {
                    onOpenLyrics(track);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <TextQuote className="h-4 w-4 text-muted-foreground" />
                  歌词
                </button>
                <button
                  onClick={() => {
                    onOpenQueue();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <List className="h-4 w-4 text-muted-foreground" />
                  播放队列
                </button>
                <button
                  onClick={() => {
                    onShare(track);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <Share className="h-4 w-4 text-muted-foreground" />
                  分享歌曲
                </button>
                <button
                  onClick={() => {
                    onDownload();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <Download className="h-4 w-4 text-muted-foreground" />
                  下载
                </button>
                <button
                  onClick={() => {
                    onOpenDownloadHistory();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  下载历史
                </button>
                <button
                  onClick={() => {
                    onToggleLikeCurrent();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <Heart className={cn("h-4 w-4", liked ? "fill-primary text-primary" : "text-muted-foreground")} />
                  {liked ? "取消红心" : "红心收藏"}
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  onClick={onCycleLevel}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <span>音质</span>
                  <span className="text-xs font-medium text-primary">{level}</span>
                </button>
                <button
                  onClick={onCycleRate}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <span>倍速</span>
                  <span className="text-xs text-muted-foreground">{rate === 1 ? "1x" : `${rate}x`}</span>
                </button>
                <button
                  onClick={onCycleSleep}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  <span>睡眠定时</span>
                  <span className={cn("text-xs", sleepMinutes !== null ? "text-primary" : "text-muted-foreground")}>
                    {sleepMinutes !== null ? `${sleepMinutes} 分` : "关"}
                  </span>
                </button>
                <div className="my-1 h-px bg-border" />
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    onClick={onToggleMute}
                    className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                    title={muted ? "取消静音" : "静音"}
                  >
                    {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    className="min-w-0 flex-1 accent-primary"
                    aria-label="音量"
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LyricsView(props: {
  track: Track;
  lines: LyricLine[];
  currentTime: number;
  onSeekTime: (time: number) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const { track, lines, currentTime, onSeekTime, onDownload, onClose } = props;
  const activeIdx = currentLineIndex(lines, currentTime);
  const [mode, setMode] = useState<"both" | "original" | "translated">("both");
  const [size, setSize] = useState<"md" | "lg" | "xl">("lg");
  const [locked, setLocked] = useState(false);
  const lockTimer = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // 手动滚动时暂停自动滚动，3 秒无操作后恢复。
  const pauseAutoScroll = useCallback(() => {
    setLocked(true);
    if (lockTimer.current !== null) window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => setLocked(false), 3000);
  }, []);

  useEffect(() => {
    if (activeIdx < 0 || locked) return;
    document.getElementById(`lyric-${activeIdx}`)?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [activeIdx, locked]);

  const sizeClass = size === "xl" ? "text-4xl" : size === "lg" ? "text-3xl" : "text-2xl";
  const modeLabel = mode === "both" ? "双语" : mode === "original" ? "原文" : "翻译";

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
        <div className="flex items-start justify-between gap-3 px-6 py-5">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-white">{track.title}</p>
            <p className="truncate text-sm text-white/70">{track.artists?.join(" / ")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() =>
                setMode((m) => (m === "both" ? "original" : m === "original" ? "translated" : "both"))
              }
              className="rounded-full px-2 py-1 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="切换歌词显示"
            >
              {modeLabel}
            </button>
            <button
              onClick={() => setSize((s) => (s === "md" ? "lg" : s === "lg" ? "xl" : "xl"))}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="增大字号"
            >
              A+
            </button>
            <button
              onClick={() => setSize((s) => (s === "xl" ? "lg" : s === "lg" ? "md" : "md"))}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="减小字号"
            >
              A-
            </button>
            <button
              onClick={onDownload}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              title="下载"
            >
              <Download className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ChevronDown className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-6 pb-32 [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]"
          onWheel={pauseAutoScroll}
          onTouchStart={(e) => {
            touchStartY.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(e) => {
            pauseAutoScroll();
            const start = touchStartY.current;
            const cur = e.touches[0]?.clientY;
            if (start !== null && cur !== undefined && cur - start > 120) {
              onClose();
              touchStartY.current = null;
            }
          }}
        >
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-7 py-[45vh] text-center">
            {lines.length === 0 ? (
              <p className="text-white/50">暂无歌词</p>
            ) : (
              lines.map((l, i) => {
                const showText = mode === "translated" ? (l.translated ?? l.text) : l.text;
                const showSub = mode === "both" && l.translated !== undefined;
                return (
                  <div
                    key={i}
                    id={`lyric-${i}`}
                    onClick={() => onSeekTime(l.time)}
                    className={cn(
                      "cursor-pointer transition-all duration-300",
                      i === activeIdx
                        ? `${sizeClass} font-bold text-white`
                        : "text-xl font-medium text-white/40 hover:text-white/70",
                    )}
                  >
                    <p>{showText}</p>
                    {showSub && i === activeIdx ? (
                      <p className="mt-1.5 text-base text-white/60">{l.translated}</p>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
