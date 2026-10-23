import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  error?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Отмена",
  busy = false,
  destructive = false,
  error,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const restoreFocus = useCallback(() => {
    const previous = previousFocusRef.current;
    const target = previous?.isConnected ? previous : document.getElementById("main-content");
    window.requestAnimationFrame(() => target?.focus());
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      window.requestAnimationFrame(() => cancelRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
      restoreFocus();
    }

    return () => {
      if (dialog.open) dialog.close();
      if (open) restoreFocus();
    };
  }, [open, restoreFocus]);

  const close = () => {
    if (busy) return;
    onOpenChange(false);
    restoreFocus();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-neutral-200 bg-white p-0 text-foreground shadow-2xl backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (open && !busy) onOpenChange(false);
      }}
    >
      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <div id={descriptionId} className="text-sm leading-6 text-muted-foreground">{description}</div>
        </div>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={close}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? "Выполняется…" : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
