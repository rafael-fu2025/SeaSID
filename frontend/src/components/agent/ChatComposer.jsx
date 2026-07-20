import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Square,
  Paperclip,
  X,
  Sparkles,
  CornerDownLeft,
  CornerDownRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
 *   suggestions:  string[] — clickable chips that fill + send the
 *                  input. Empty array hides the suggestion row.
 *   placeholder:  string — placeholder for the textarea
 *   maxRows:     number — soft cap on auto-growth (default 6)
 */
export default function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy = false,
  siteKey,
  suggestions = [],
  placeholder = 'Ask the agent…',
  maxRows = 6,
}) {
  const taRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

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

  const canSend = value.trim().length > 0 && !busy;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
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

  // Word + character count, shown in the meta row. Cheap, debounced
  // implicitly by React's render cycle.
  const charCount = value.length;
  const wordCount = value.trim() === '' ? 0 : value.trim().split(/\s+/).length;
  const charLimit = 2000;
  const overLimit = charCount > charLimit;

  return (
    <div
      data-testid="agent-composer"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-xl border bg-card transition-all',
        isDragOver
          ? 'border-reef ring-2 ring-reef/30 bg-reef/5'
          : isFocused
            ? 'border-reef/60 ring-2 ring-reef/20 shadow-sm'
            : 'border-border shadow-xs',
        busy && 'opacity-90',
      )}
    >
      {suggestions.length > 0 && (
        <div
          className="flex gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2"
          data-testid="agent-suggestions"
        >
          <Sparkles className="size-3.5 shrink-0 text-reef" aria-hidden />
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onSend(s)}
              disabled={busy}
              data-testid={`agent-suggestion-${idx}`}
              className={cn(
                'shrink-0 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px]',
                'text-foreground/80 transition-colors hover:border-reef/40 hover:bg-reef/5 hover:text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              disabled
              aria-label="Attach file (coming soon)"
              data-testid="agent-attach"
            >
              <Paperclip className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Attachments coming soon — drop a file to mention it for now
          </TooltipContent>
        </Tooltip>

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
              'placeholder:text-muted-foreground/70',
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
                className="size-8 shrink-0 bg-danger text-danger-foreground hover:bg-danger/90"
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
                onClick={onSend}
                disabled={!canSend}
                size="icon"
                className={cn(
                  'size-8 shrink-0 transition-all',
                  canSend
                    ? 'bg-reef text-white shadow-sm hover:bg-reef/90'
                    : 'bg-muted text-muted-foreground',
                )}
                aria-label="Send message"
                data-testid="agent-send"
              >
                <Send className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Send (Enter)</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        className={cn(
          'flex items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5 text-[11px]',
          'text-muted-foreground',
        )}
      >
        <div className="flex items-center gap-2">
          {siteKey && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-muted-foreground"
              data-testid="agent-composer-site"
            >
              {siteKey}
            </Badge>
          )}
          {isDragOver ? (
            <span className="text-reef">Drop file to attach</span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1">
              <CornerDownLeft className="size-3" aria-hidden />
              <span>send</span>
              <span className="text-muted-foreground/50">·</span>
              <CornerDownRight className="size-3" aria-hidden />
              <span>newline</span>
            </span>
          )}
        </div>
        <span
          className={cn(
            'tabular-nums',
            overLimit && 'text-danger',
            charCount > 0 && charCount > charLimit * 0.8 && !overLimit && 'text-amber-500',
          )}
          data-testid="agent-char-count"
        >
          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {charCount}/{charLimit}
        </span>
      </div>
    </div>
  );
}
