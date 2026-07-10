import { useState } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallRow } from './ToolCallRow';

/**
 * ToolCallGroup — collapses N tool calls into a single Astryx-style
 * summary header when N > 1, expands to a stacked list on click.
 *
 *   [wrench]  N tool calls              ⌄
 *     ── collapsed card row 1
 *     ── card row 2 (newest)
 *
 * Latest call is always reflected in the summary header so the user
 * can read what's currently happening even when the list is collapsed.
 */
export function ToolCallGroup({ calls }) {
  if (!calls || calls.length === 0) return null;
  if (calls.length === 1) {
    return <ToolCallRow call={calls[0]} />;
  }

  const [open, setOpen] = useState(false);
  const latest = calls[calls.length - 1];
  const latestName = latest.name ?? 'unknown';

  return (
    <div className="flex flex-col gap-1" data-testid="tool-call-group">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-none border border-border bg-card px-2 py-1.5 text-left text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        data-testid="tool-call-group-toggle"
      >
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          {calls.length} tool calls
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
            latest: {latestName}
          </span>
          <ChevronDown
            className={cn(
              'size-3 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1">
          {calls.map((call, i) => (
            <ToolCallRow key={call.id ?? `${call.name ?? 'tc'}-${i}`} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
