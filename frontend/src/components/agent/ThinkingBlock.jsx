import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ThinkingBlock — collapsible display for the agent's  Chain-of-Thought.
 *
 * Ported from minimax_cb's `<div class="thinking-block">` shell:
 *   - brain-icon trigger labelled "Thinking"
 *   - body is a mono, full-width, dim pre
 *   - collapsed by default (so the visible answer is the focus)
 *
 * Implementation: HTML-native `<details>` so it's accessible + zero
 * state, instead of pulling in shadcn Collapsible.
 */
export function ThinkingBlock({ children, defaultOpen = false, label = 'Thinking' }) {
  const [open, setOpen] = useState(defaultOpen);
  const text = typeof children === 'string' ? children : '';
  if (!text || !text.trim()) return null;

  return (
    <div
      className="my-2 border border-border bg-card"
      data-testid="thinking-block"
      data-open={open}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-muted/30"
        data-testid="thinking-toggle"
      >
        <Brain className="size-3 shrink-0" />
        <span className="text-[11px] font-medium uppercase tracking-wider">
          {label}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground/70">
          {text.length} chars
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-inset/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground',
          !open && 'hidden',
        )}
        data-testid="thinking-body"
      >
        {text}
      </pre>
    </div>
  );
}
