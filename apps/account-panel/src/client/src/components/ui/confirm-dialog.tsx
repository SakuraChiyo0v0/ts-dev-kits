import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "./button";
import { useEscToClose } from "@/lib/use-esc";

/**
 * 统一确认对话框：替代 window.confirm / window.prompt。
 * 危险操作（删除等）用 destructive 样式；输入类操作由调用方自行渲染表单内容。
 */
export function ConfirmDialog(props: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { title, description, confirmLabel = "确认", cancelLabel = "取消", destructive, onConfirm, onClose } =
    props;
  const [submitting, setSubmitting] = useState(false);
  useEscToClose(onClose, !submitting);

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // 操作失败：恢复按钮可用（错误反馈由调用方 toast 提供）。
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-fade-in rounded-2xl bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {destructive === true ? (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </span>
            ) : null}
            <div>
              <h3 className="text-base font-bold">{title}</h3>
              {description !== undefined ? (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1 rounded-full" onClick={onClose} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={destructive === true ? "destructive" : "default"}
            className="flex-1 rounded-full"
            onClick={() => void confirm()}
            disabled={submitting}
          >
            {submitting ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
