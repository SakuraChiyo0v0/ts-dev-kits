import type { ReactNode } from "react";
import { Button } from "./button";

/**
 * 统一空状态：图标 + 标题 + 说明 + 可选引导动作。
 * 所有「暂无/为空/无结果」场景统一用它，替代纯文本占位。
 */
export function EmptyState(props: {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  const { icon, title, description, actionLabel, onAction, className } = props;
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-16 text-center ${className ?? ""}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description !== undefined ? (
          <p className="mx-auto max-w-xs text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button size="sm" variant="outline" className="rounded-full" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
