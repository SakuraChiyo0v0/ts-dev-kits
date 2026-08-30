import { useState } from "react";
import { Clapperboard, Music2, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscToClose } from "@/lib/use-esc";

/**
 * 首次引导 Onboarding：首次打开应用时展示 3 屏（这是什么 → 三个模块 → 开始使用）。
 * 看过一次后 localStorage 标记，不再打扰；可在首页重新打开。
 */

const STORAGE_KEY = "onboarding-seen-v1";

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // 忽略。
  }
}

const STEPS = [
  {
    icon: <Music2 className="h-8 w-8" />,
    title: "一个入口，管理你的媒体",
    description: "账号面板把网易云音乐、B 站视频、番剧聚合到一个界面：扫码绑定一次，随时听歌、看视频、追番。",
  },
  {
    icon: <Tv className="h-8 w-8" />,
    title: "三个模块，随时切换",
    description: "左侧导航（手机上为底部标签）可随时切换音乐 / 哔哩哔哩 / 番剧；切换到视频或番剧时音乐会暂停，切回可继续播放。",
  },
  {
    icon: <Clapperboard className="h-8 w-8" />,
    title: "下载到 NAS，离线也能看",
    description: "看到喜欢的歌、视频、番剧，可一键下载到 NAS，随时随地离线享受。",
  },
];

export function Onboarding(props: { onDone: () => void }) {
  const { onDone } = props;
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  if (current === undefined) return null;

  const finish = () => {
    markOnboardingSeen();
    onDone();
  };
  useEscToClose(finish);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="欢迎使用账号面板">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          {current.icon}
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{current.title}</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {current.description}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 px-8 pb-12">
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={
                i === step ? "h-1.5 w-6 rounded-full bg-primary" : "h-1.5 w-1.5 rounded-full bg-muted-foreground/30"
              }
            />
          ))}
        </div>
        <div className="flex w-full max-w-xs gap-2">
          {step > 0 ? (
            <Button variant="ghost" className="flex-1 rounded-full" onClick={() => setStep((s) => s - 1)}>
              上一步
            </Button>
          ) : null}
          <Button
            className={step > 0 ? "flex-1 rounded-full" : "w-full rounded-full"}
            size="lg"
            onClick={() => {
              if (step < STEPS.length - 1) setStep((s) => s + 1);
              else finish();
            }}
          >
            {step < STEPS.length - 1 ? "下一步" : "开始使用"}
          </Button>
        </div>
        {step > 0 ? (
          <button
            onClick={finish}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            跳过引导
          </button>
        ) : null}
      </div>
    </div>
  );
}
