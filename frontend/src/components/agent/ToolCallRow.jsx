import { useState } from 'react';
import {
  ChevronDown, ChevronRight,
  Check, X, Loader2, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ToolCallRow — one row per tool call in the assistant transcript.
 *
 * Ported from `ChatToolCalls` (Meta Astryx) used in minimax_cb:
 *
 *   [status-icon]  name · argPreview          durationMs
 *
 *  - The status icon is a tinted circle backing an inner glyph; the
 *    backing takes status colours (`running`/`error`) but at low
 *    opacity so the lane reads as "muted metadata".
 *  - `running` and `pending` use a spinner instead of a glyph so the
 *    user sees the call is in flight.
 *  - Clicking (or pressing Enter / Space) expands a collapsible panel
 *    with the raw JSON input + raw output, mirroring Astryx's
 *    `renderDetail` slot. Errors auto-open.
 *  - Tool calls whose `result` is missing render as pending; when the
 *    output eventually arrives they flip to complete.
 */

const STATUS_ICON = {
  pending:  Clock,
  running:  Loader2,
  complete: Check,
  error:    X,
};

const STATUS_TINT = {
  pending:  'text-muted-foreground',
  running:  'text-reef',
  complete: 'text-positive',
  error:    'text-danger',
};

function normalizeStatus(call) {
  if (call.status) return call.status;
  if (call.error)   return 'error';
  if (call.result)  return 'complete';
  return 'pending';
}

function formatArgs(args) {
  if (args == null) return null;
  let obj = args;
  if (typeof args === 'string') {
    try { obj = JSON.parse(args); } catch { return truncate(args, 40); }
  }
  if (typeof obj !== 'object' || obj == null) return truncate(String(obj), 40);
  const entries = Object.entries(obj);
  if (entries.length === 0) return null;
  const [k, v] = entries[0];
  let vStr;
  if (typeof v === 'string') vStr = JSON.stringify(v);
  else if (typeof v === 'object' && v != null) vStr = JSON.stringify(v);
  else vStr = String(v);
  return `${k}=${truncate(vStr, 30)}`;
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function formatDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallRow({ call, defaultOpen = false }) {
  const status = normalizeStatus(call);
  const Icon    = STATUS_ICON[status] ?? Clock;
  const tint    = STATUS_TINT[status];
  const argPreview = formatArgs(call.arguments);
  const duration = formatDuration(call.durationMs);
  const hasDetail =
    call.arguments != null ||
    (call.result != null && call.result !== '') ||
    (call.error != null && call.error !== '');
  const [open, setOpen] = useState(defaultOpen || status === 'error');

  return (
    <div
      className={cn(
        'border bg-card text-foreground transition-colors',
        status === 'running' ? 'border-reef/40' : 'border-border',
      )}
      data-testid={`tool-call-row-${call.name ?? 'unknown'}`}
      data-status={status}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        data-testid={`tool-call-toggle-${call.name ?? 'unknown'}`}
      >
        <span
          className={cn(
            'relative inline-flex size-5 shrink-0 items-center justify-center rounded-full',
          )}
        >
          <span
            aria-hidden
            className={cn('absolute inset-0 rounded-full bg-current opacity-15', tint)}
          />
          <Icon
            aria-hidden
            className={cn(
              'relative size-3',
              tint,
              status === 'running' && 'animate-spin',
            )}
          />
        </span>

        <span className="shrink-0 font-mono text-xs font-medium text-foreground">
          {call.name ?? 'unknown'}
        </span>

        {argPreview && (
          <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
            {argPreview}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 pl-2">
          {duration && status === 'complete' && (
            <span className="font-mono text-[11px] text-muted-foreground">{duration}</span>
          )}
          {hasDetail && (
            open
              ? <ChevronDown className="size-3 text-muted-foreground" />
              : <ChevronRight className="size-3 text-muted-foreground" />
          )}
        </span>
      </button>

      {open && hasDetail && (
        <div className="border-t border-border bg-inset/40 px-2 py-1.5">
          {call.arguments != null && (
            <ToolDetail label="Input">
              {typeof call.arguments === 'string'
                ? call.arguments
                : JSON.stringify(call.arguments, null, 2)}
            </ToolDetail>
          )}
          {call.error != null && call.error !== '' && (
            <ToolDetail label="Error" tone="danger">
              {call.error}
            </ToolDetail>
          )}
          {call.result != null && call.result !== '' && (
            <ToolDetail
              label="Output"
              maxHeight
              tone={status === 'error' ? 'danger' : 'default'}
            >
              {call.result}
            </ToolDetail>
          )}
        </div>
      )}
    </div>
  );
}

function ToolDetail({ label, tone = 'default', maxHeight = false, children }) {
  return (
    <div className="first:mt-0 mt-1.5">
      <div
        className={cn(
          'text-[10px] font-medium uppercase tracking-wider',
          tone === 'danger' ? 'text-danger' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          'mt-0.5 max-w-full whitespace-pre-wrap break-words font-mono text-[11px] leading-snug',
          tone === 'danger' ? 'text-danger' : 'text-foreground/90',
          maxHeight && 'max-h-48 overflow-auto',
        )}
      >
        {children}
      </pre>
    </div>
  );
}
