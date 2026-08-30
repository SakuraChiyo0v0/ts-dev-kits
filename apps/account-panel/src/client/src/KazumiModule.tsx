import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ChevronLeft,
  Clapperboard,
  Download,
  FilePlus2,
  Folder,
  FolderPlus,
  ListChecks,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { rpc } from "./lib/rpc";
import DownloadHistoryPanel from "./DownloadHistoryPanel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

// ---------- 主组件 ----------

export default function KazumiModule({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<"home" | "rules" | "result">("home");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [roads, setRoads] = useState<Road[]>([]);
  const [roadIndex, setRoadIndex] = useState(0);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<Episode | null>(null);
  const [showDownloadHistory, setShowDownloadHistory] = useState(false);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [m3u8Url, setM3u8Url] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const playEpisode = useCallback(async (ep: Episode) => {
    if (selected === null) return;
    setPlayingEpisode(ep);
    setM3u8Url(null);
    setPlayLoading(true);
    try {
      const res = await rpc.api.kazumi.stream.$get({ query: { url: ep.url, rule: selected.rule } });
      const data = (await res.json()) as { m3u8Url?: string; error?: string };
      if (data.error !== undefined) {
        showToast(`播放失败 ${data.error}`);
        setPlayingEpisode(null);
      } else if (data.m3u8Url !== undefined) {
        setM3u8Url(data.m3u8Url);
      }
    } catch {
      showToast("播放失败");
      setPlayingEpisode(null);
    } finally {
      setPlayLoading(false);
    }
  }, [selected, showToast]);

  const doSearch = useCallback(async (kw?: string) => {
    const keyword = (kw ?? query).trim();
    if (keyword === "") return;
    setQuery(keyword);
    setSearching(true);
    try {
      const res = await rpc.api.kazumi.search.$get({ query: { q: keyword } });
      const data = (await res.json()) as { items?: SearchItem[] };
      setResults(data.items ?? []);
      setView("result");
    } catch {
      showToast("搜索失败（可能被验证码拦截）");
    } finally {
      setSearching(false);
    }
  }, [query, showToast]);

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
      showToast("获取线路失败");
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
      showToast("获取集数失败");
    }
  }, [selected, showToast]);

  useEffect(() => {
    const road = roads[roadIndex];
    if (road !== undefined) void loadEpisodes(road);
  }, [roads, roadIndex, loadEpisodes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center gap-2.5">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />服务列表
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Clapperboard className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold">番剧</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setShowDownloadHistory(true)}>
            <Download />下载历史
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => { setView("rules"); setSelected(null); setResults([]); }}>
            <ListChecks />规则管理
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {view === "rules" ? (
          <RulesView onBack={() => setView("home")} onToast={showToast} />
        ) : selected === null ? (
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-4xl px-4 py-10">
              <h1 className="mb-6 text-2xl font-bold">番剧搜索</h1>
              <div className="mb-6 flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索番剧（打全部规则源）…"
                  className="rounded-full"
                  onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
                />
                <Button className="rounded-full" onClick={() => void doSearch()} disabled={searching}>
                  <Search />搜索
                </Button>
              </div>
              {searching ? (
                <p className="py-16 text-center text-sm text-muted-foreground">搜索中（遍历多个番剧源，约需 20 秒）…</p>
              ) : results.length > 0 ? (
                <ul className="divide-y divide-border/60 rounded-2xl border bg-card">
                  {results.map((it, i) => (
                    <li key={`${it.src}-${i}`}>
                      <button onClick={() => void openItem(it)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted">
                        <Play className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{it.name}</p>
                          <p className="truncate text-xs text-muted-foreground">源：{it.rule}</p>
                        </div>
                        <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
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
              <button onClick={() => { setSelected(null); setResults([]); }} className="mb-4 flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />返回搜索
              </button>
              <h1 className="mb-4 text-xl font-bold">{selected.name}</h1>
              <p className="mb-4 text-xs text-muted-foreground">源：{selected.rule}</p>

              {loadingRoads ? (
                <p className="py-10 text-center text-sm text-muted-foreground">加载线路中…</p>
              ) : roads.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">无可用线路</p>
              ) : (
                <>
                  {/* 线路选择 */}
                  <div className="mb-4 flex flex-wrap gap-2">
                    {roads.map((r, i) => (
                      <button
                        key={`${r.name}-${i}`}
                        onClick={() => setRoadIndex(i)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs transition-colors",
                          roadIndex === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                        )}
                      >
                        {r.name || `线路${i + 1}`}
                      </button>
                    ))}
                  </div>

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
                    {episodes.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">暂无集数</li> : null}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {toast !== null ? (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 animate-fade-in rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}

      {downloadTarget !== null && selected !== null ? (
        <KazumiDownloadDialog
          episode={downloadTarget}
          rule={selected.rule}
          onDownload={async (path) => {
            try {
              setDownloading(downloadTarget.url);
              const res = await rpc.api.kazumi.download.$post({
                json: { rule: selected.rule, name: downloadTarget.name, url: downloadTarget.url, ...(path.trim() !== "" ? { path: path.trim() } : {}) },
              });
              const data = (await res.json()) as { filePath?: string; error?: string };
              if (data.error !== undefined) showToast(`下载失败 ${data.error}`);
              else showToast("已下载到 NAS");
            } catch {
              showToast("下载失败");
            } finally {
              setDownloading(null);
            }
          }}
          onClose={() => setDownloadTarget(null)}
        />
      ) : null}

      {showDownloadHistory ? <DownloadHistoryPanel onClose={() => setShowDownloadHistory(false)} platform="kazumi" /> : null}

      {playingEpisode !== null ? (
        <KazumiPlayer
          episode={playingEpisode}
          m3u8Url={m3u8Url}
          loading={playLoading}
          onClose={() => { setPlayingEpisode(null); setM3u8Url(null); }}
        />
      ) : null}
    </div>
  );
}

/** 番剧在线播放器（hls.js 播放代理 m3u8）。 */
function KazumiPlayer(props: { episode: Episode; m3u8Url: string | null; loading: boolean; onClose: () => void }) {
  const { episode, m3u8Url, loading, onClose } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="w-full max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between text-white">
          <p className="truncate text-sm font-medium">{episode.name}</p>
          <button onClick={onClose} className="rounded-full p-2 transition-colors hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          {loading ? (
            <div className="flex h-full w-full items-center justify-center text-sm text-white/70">解析播放地址中…</div>
          ) : (
            <video ref={videoRef} controls autoPlay playsInline className="h-full w-full" />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 规则管理 ----------

function RulesView(props: { onBack: () => void; onToast: (m: string) => void }) {
  const { onBack, onToast } = props;
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await rpc.api.kazumi.rules.$get();
      const data = (await res.json()) as { rules?: string[] };
      setRules((data.rules ?? []).map((name) => ({ name })));
    } catch {
      onToast("读取规则失败");
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load]);

  const addRule = async () => {
    let json: unknown;
    try {
      json = JSON.parse(jsonText);
    } catch {
      onToast("JSON 解析失败");
      return;
    }
    try {
      const res = await rpc.api.kazumi.rules.add.$post({ json: { json } });
      const data = (await res.json()) as { ok?: boolean; name?: string; error?: string };
      if (data.error !== undefined) onToast(`添加失败：${data.error}`);
      else {
        onToast(`已添加规则 ${data.name ?? ""}`);
        setJsonText("");
        setAdding(false);
        await load();
      }
    } catch {
      onToast("添加失败");
    }
  };

  const removeRule = async (name: string) => {
    try {
      await rpc.api.kazumi.rules.remove.$post({ json: { name } });
      onToast("已删除");
      await load();
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

        <ul className="divide-y divide-border/60 rounded-2xl border bg-card">
          {rules.map((r) => (
            <li key={r.name} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
              </div>
              <button onClick={() => void removeRule(r.name)} className="shrink-0 rounded-full p-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {rules.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">暂无规则，请添加番剧源规则</li> : null}
        </ul>
      </div>
    </div>
  );
}

// ---------- 下载对话框 ----------

function KazumiDownloadDialog(props: { episode: Episode; rule: string; onDownload: (path: string) => void; onClose: () => void }) {
  const { episode, rule, onDownload, onClose } = props;
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
        <p className="mb-3 truncate text-sm text-muted-foreground">{episode.name} · {rule}</p>
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
