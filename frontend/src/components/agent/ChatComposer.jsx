import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ArrowUp,
  Square,
  Plus,
  Image as ImageIcon,
  FileText,
  FileIcon,
  X as XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const PDF_MIMES = new Set(['application/pdf']);

function classifyAttachment(mime) {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (PDF_MIMES.has(mime)) return 'pdf';
  return 'other';
}

function iconFor(kind) {
  switch (kind) {
    case 'image':
      return ImageIcon;
    case 'pdf':
      return FileText;
    default:
      return FileIcon;
  }
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * ChatComposer — the input bar at the bottom of the agent sheet.
 *
 * Why a dedicated component?
 *  - The original AgentFab composer was a flat <Input> with a single
 *    "Enter to send" hint. That was honest but limited: real chat UIs
 *    expect multi-line drafts, a stop-while-streaming control, quick
 *    prompts, and a real site-context badge. Lifting the composer into
 *    its own component lets us iterate on the visual design without
 *    touching the FAB's plumbing.
 *
 *  - The component is purely controlled. Parent owns `value`, `busy`,
 *    `onSend`, `onStop`, `onPromptChip` — we only manage local
 *    textarea growth + drag/drop state.
 *
 * Public API:
 *   value:        string — current draft text (controlled)
 *   onChange:     (next: string) => void
 *   onSend:       () => void — Enter pressed or send button clicked
 *   onStop:       () => void — visible while busy
 *   busy:         boolean — disables the textarea + shows Stop
 *   siteKey:      string — shown as a small chip in the corner so the
 *                  operator always sees which site the next prompt
 *                  will be sent against.
 *   placeholder:  string — placeholder for the textarea
 *   maxRows:     number — soft cap on auto-growth (default 6)
 *
 * Imperative handle (ref.current):
 *   .focus()      — moves keyboard focus into the textarea and places
 *                   the caret at the end. Used by AgentFab to:
 *                     1. autofocus when the sheet opens
 *                     2. refocus after the stream finishes so the
 *                        operator can type the follow-up without
 *                        clicking back into the field
 *                     3. refocus after Reset / chip-selection
 *                   Safe to call when the textarea is disabled
 *                   (busy); the call is queued via a microtask so
 *                   it lands as soon as `busy` flips back to false.
 */
const ChatComposer = forwardRef(function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy = false,
  placeholder = 'Ask the agent…',
  maxRows = 6,
}, ref) {

  const taRef = useRef(null);
  const photoInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Local state for the attachment menu. Radix DropdownMenu was being
  // clipped by the Sheet container and the synthetic click event was
  // being swallowed, so the native popover pattern keeps the menu
  // visible and the file pickers responsive.
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  // Track files the operator attached through the menu or drag/drop.
  // Each entry mirrors the reference AttachmentList shape: an id, the
  // raw File, a mime, a kind, and a previewUrl when we can build one.
  // The chip strip is rendered above the textarea; we no longer append
  // a `[file: name]` text stub because the chip itself is the source of
  // truth for the attachment.
  const [attachments, setAttachments] = useState([]);
  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const attachFile = (file) => {
    if (!file) return;
    const id = `${file.name}:${file.size}:${file.lastModified}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const kind = classifyAttachment(file.type || '');
    const previewUrl =
      kind === 'image' && typeof URL !== 'undefined' && URL.createObjectURL
        ? URL.createObjectURL(file)
        : undefined;
    setAttachments((prev) => [
      ...prev,
      { id, name: file.name, mime: file.type || '', size: file.size, kind, previewUrl, file },
    ]);
  };

  const handlePhoto = (event) => {
    const file = event.target.files?.[0];
    attachFile(file);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };
  const handleDocument = (event) => {
    const file = event.target.files?.[0];
    attachFile(file);
    if (documentInputRef.current) documentInputRef.current.value = '';
  };

  // Close the attachment menu when the operator clicks anywhere outside
  // it (matches the reference MultimodalComposer behavior).
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [isMenuOpen]);

  // Auto-grow the textarea as the user types. We measure scrollHeight
  // after every value change and clamp to maxRows-worth of pixels.
  // A min-height (set via rows={1}) keeps a single-line state from
  // collapsing to nothing when the user clears the field.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 22; // matches leading-relaxed at text-sm
    const max = lineHeight * maxRows + 16; // +padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, maxRows]);

  // Keep the caret at the end when the parent swaps `value` out from
  // under us (e.g. clicking a suggestion chip). Without this, React
  // moves the cursor to the start which is jarring.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const len = value.length;
    if (document.activeElement === el && el.selectionStart !== len) {
      el.setSelectionRange(len, len);
    }
  }, [value]);

  /**
   * Imperative focus handle — lets AgentFab pull the caret back into
   * the textarea without having to thread a ref through every layer.
   * The implementation defers via queueMicrotask when busy is true
   * so a `focus()` call right after `setBusy(false)` lands as soon
   * as the textarea is re-enabled.
   */
  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = taRef.current;
      if (!el) return;
      if (el.disabled) {
        // Busy: try again on the next microtask when React has
        // flipped the disabled flag back to false.
        queueMicrotask(() => {
          const inner = taRef.current;
          if (inner && !inner.disabled) {
            inner.focus();
            const len = inner.value.length;
            inner.setSelectionRange(len, len);
          }
        });
        return;
      }
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    },
  }), []);

  const canSend = value.trim().length > 0 && !busy;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  // Bypass the Tooltip wrapper when firing the send action so the
  // synthetic click from TooltipTrigger asChild never steals the
  // pointer event away from the underlying button.
  const handleSendClick = () => {
    if (canSend) onSend();
  };

  // Drag-and-drop support: a file dropped onto the composer becomes
  // an @-mention-style stub. Files aren't uploaded yet (the agent
  // doesn't accept attachments) but we surface the affordance so the
  // UX contract matches what the model can eventually consume.
  const handleDragOver = (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some((i) => i.kind === 'file')) {
      e.preventDefault();
      setIsDragOver(true);
    }
  };
  const handleDragLeave = (e) => {
    if (e.currentTarget === e.target) setIsDragOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    // Stub: append filenames to the draft as plain text. Real
    // attachments would push binary blobs into the message payload.
    const names = files.map((f) => f.name).join(', ');
    onChange((value ? value.trimEnd() + ' ' : '') + `[file: ${names}] `);
  };

  return (
    <div
      data-testid="agent-composer"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-xl border bg-muted/40 transition-all',
        isDragOver
          ? 'border-reef ring-2 ring-reef/30 bg-reef/5'
          : isFocused
            ? 'border-reef/60 ring-2 ring-reef/20 shadow-sm'
            : 'border-border shadow-xs',
        busy && 'opacity-90',
      )}
    >
      <div className="flex flex-col gap-2 p-2.5">
        {attachments.length > 0 && (
          <div
            className="flex flex-wrap gap-2"
            role="list"
            aria-label="Attachments"
            data-testid="agent-attachments"
          >
            {attachments.map((a) => {
              const IconCmp = iconFor(a.kind);
              return (
                <div
                  key={a.id}
                  role="listitem"
                  data-testid="agent-attachment"
                  data-kind={a.kind}
                  className="flex w-full max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground"
                  title={`${a.name} (${humanSize(a.size)})`}
                >
                  {a.kind === 'image' && a.previewUrl ? (
                    <img
                      src={a.previewUrl}
                      alt=""
                      aria-hidden
                      className="size-8 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded bg-popover text-muted-foreground"
                    >
                      <IconCmp className="size-3.5" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium" title={a.name}>
                      {a.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {humanSize(a.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${a.name}`}
                    data-testid="agent-attachment-remove"
                    className="size-6 shrink-0 rounded-full"
                    onClick={() => removeAttachment(a.id)}
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-end gap-2">
        <div ref={menuRef} className="relative shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-full bg-black text-white dark:bg-white dark:text-black"
            aria-label="Attach file"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            data-testid="agent-attach"
            onClick={() => setIsMenuOpen((value) => !value)}
          >
            <Plus className="size-4" />
          </Button>
          {isMenuOpen && (
            <div
              role="menu"
              aria-label="Upload"
              className="absolute bottom-full left-0 z-50 mb-2 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsMenuOpen(false);
                  photoInputRef.current?.click();
                }}
                data-testid="agent-attach-photo"
                className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
              >
                <ImageIcon className="size-3.5" aria-hidden />
                <span>Upload photo</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsMenuOpen(false);
                  documentInputRef.current?.click();
                }}
                data-testid="agent-attach-document"
                className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
              >
                <FileText className="size-3.5" aria-hidden />
                <span>Upload document</span>
              </button>
            </div>
          )}
        </div>

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhoto}
          data-testid="agent-attach-photo-input"
        />
        <input
          ref={documentInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.csv,.md,application/pdf,text/plain,text/csv"
          className="hidden"
          onChange={handleDocument}
          data-testid="agent-attach-document-input"
        />

        <div className="min-w-0 flex-1">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            disabled={busy}
            rows={1}
            aria-label="Message the agent"
            data-testid="agent-input"
            className={cn(
              'w-full resize-none border-0 bg-transparent px-1 py-1.5 text-sm leading-relaxed',
              'placeholder:text-black/70 dark:placeholder:text-white/70',
              'focus:outline-none focus:ring-0',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'text-foreground',
            )}
          />
        </div>

        {busy ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={onStop}
                size="icon"
                className="size-8 shrink-0 rounded-full bg-danger text-danger-foreground hover:bg-danger/90"
                aria-label="Stop generating"
                data-testid="agent-stop"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Stop generating</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={handleSendClick}
                disabled={!canSend}
                size="icon"
                className={cn(
                  'size-8 shrink-0 rounded-full transition-all',
                  canSend
                    ? 'bg-foreground text-background shadow-sm hover:bg-foreground/90'
                    : 'bg-muted text-muted-foreground',
                )}
                aria-label="Send message"
                data-testid="agent-send"
              >
                <ArrowUp className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Send (Enter)</TooltipContent>
          </Tooltip>
        )}
        </div>
      </div>
    </div>
  );
});

export default ChatComposer;
