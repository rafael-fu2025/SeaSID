import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * ConfirmDialog — controlled confirmation dialog that mirrors the
 * dashboard's "ok" / "cancel" UX instead of the browser's native
 * ``window.confirm``. Use this anywhere the app used to call
 * ``window.confirm`` to keep the styling consistent (and to give tests
 * a real DOM node to assert on rather than a window spy).
 *
 *  - ``tone``        — ``'default'`` uses the primary Button for confirm;
 *                      ``'danger'`` swaps it for the destructive variant.
 *  - ``open``        — controlled visibility flag.
 *  - ``onOpenChange``— called with the requested next state.
 *  - ``onConfirm``   — fires after the user clicks the confirm button.
 *                      Caller is responsible for closing the dialog
 *                      (via ``onOpenChange(false)`` or by setting
 *                      ``open`` back to ``false``).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  destructive = false,
  children,
  className,
}) {
  const Icon = tone === 'danger' ? AlertTriangle : Info;
  const iconClass = tone === 'danger' ? 'text-danger' : 'text-reef';
  const confirmVariant = destructive || tone === 'danger' ? 'destructive' : 'default';

  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!busy}
        className={cn('sm:max-w-md', className)}
        data-testid="confirm-dialog"
      >
        <DialogHeader className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full',
                tone === 'danger' ? 'bg-danger/15' : 'bg-reef/15',
              )}
              aria-hidden
            >
              <Icon className={cn('size-5', iconClass)} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        {children && <div className="px-1 text-sm text-foreground">{children}</div>}
        <DialogFooter className="mt-2 flex flex-row justify-end gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange?.(false)}
            disabled={busy}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={busy}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * useConfirmDialog — small stateful helper that wires ``open`` to a
 * parent component. Returns the controlled flag plus open/close
 * helpers so call sites don't have to wire ``useState`` themselves.
 */
export function useConfirmDialog(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, setOpen, onOpenChange: setOpen };
}

export default ConfirmDialog;
