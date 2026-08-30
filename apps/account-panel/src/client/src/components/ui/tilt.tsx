import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 3D 倾斜 hover 效果：鼠标移动时封面随光标轻微旋转、放大，移出回正。
 * 用于歌单/专辑封面，营造 Apple Music 的质感。
 */
export function Tilt({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // 尊重「减少动态效果」：用户开启时禁用 3D 倾斜。
  const reducedMotion = React.useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (el === null || reducedMotion.current) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${y * -10}deg) scale3d(1.03, 1.03, 1.03)`;
  };

  const handleLeave = () => {
    const el = ref.current;
    if (el === null) return;
    el.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={cn(
        "transition-transform duration-200 ease-out will-change-transform",
        className,
      )}
    >
      {children}
    </div>
  );
}
