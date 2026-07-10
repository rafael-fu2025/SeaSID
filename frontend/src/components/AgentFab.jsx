import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bot, Send, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { api, streamChat } from '@/api';
import MarkdownResponse from './MarkdownResponse';
import { Message } from './agent/Message';
import { StreamingDots } from './agent/StreamingDots';
import {
  makeThinkingState, feedThinking, flushThinking,
} from './agent/streaming-thinking';

/**
 * newMessageId — small monotonic id generator for client-side message
 * tracking. The server uses UUIDs; locally we just need a unique key.
 */
let _id = 0;
function newMessageId() {
  _id += 1;
  return `m-${Date.now().toString(36)}-${_id}`;
}

/**
 * AgentFab — floating AI assistant.
 *
 *  - Anchored bottom-right as a single circular trigger.
 *  - Opens a shadcn Sheet (side=right) on click.
 *  - Sheet hosts a scrollable transcript and a sticky input row.
 *  - Listens for `seasid:open-agent` (dispatched by CommandPalette)
 *    so palette users can summon it without a click.
 *  - Uses the same `/api/v1/agent/chat` contract as before, just
 *    wrapped in a more polished container.
 */
const PROMPTS = [
  'Should I dive at Dauin tomorrow morning?',
  'Compare current conditions across both sites.',
  'Generate a one-page safety briefing for Apo Island.',
];

function AgentFab({ initialSiteKey = 'dauin_muck' }) {
  const [open, setOpen] = useState(false);
  const [siteKey] = useState(initialSiteKey);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const scrollRef = useRef(null);
  const location = useLocation();

  // Hide the floating trigger on the Map page — the Leaflet map's
  // bottom-right control cluster sits in the same spot, and the FAB
  // button intercepts clicks meant for the map. Users on /map can
  // still summon the agent via the in-page header button or ⌘.
  const hideFab = location.pathname.startsWith('/map');

  // External trigger from CommandPalette (and the in-page "Open agent"
  // button on the Map page).
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('seasid:open-agent', handler);
    return () => window.removeEventListener('seasid:open-agent', handler);
  }, []);

  // Notify the rest of the app whenever the Sheet opens or closes so
  // Leaflet maps / canvas charts can recompute their size. We dispatch
  // on every transition (open and close) and let consumers debounce.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('seasid:agent-sheet', { detail: { open } }),
    );
  }, [open]);

  // Auto-scroll transcript on new content
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const userMsg = { id: newMessageId(), role: 'user', content: text };
    const assistantMsg = {
      id: newMessageId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      status: 'streaming',
    };
    setMessages([...messages, userMsg, assistantMsg]);
    setDraft('');
    setBusy(true);

    const controller = new AbortController();
    const think = makeThinkingState();

    /**
     * Helper: patch the assistant message in-place by id.
     * `patch` is a Partial<UiMessage> or a function (prev) => Partial.
     */
    const patchAssistant = (patch) => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== assistantMsg.id) return m;
        return typeof patch === 'function' ? { ...m, ...patch(m) } : { ...m, ...patch };
      }));
    };

    try {
      for await (const ev of streamChat({
        message: text,
        conversationId,
        siteKey,
        signal: controller.signal,
      })) {
        switch (ev.type) {
          case 'status':
            if (ev.conversation_id) {
              setConversationId((cur) => cur || ev.conversation_id);
            }
            break;

          case 'text': {
            const split = feedThinking(think, ev.delta);
            if (split.visible) {
              patchAssistant((prev) => ({
                content: (prev.content ?? '') + split.visible,
              }));
            }
            if (split.thinking) {
              patchAssistant((prev) => ({
                thinking: (prev.thinking ?? '') + split.thinking,
              }));
            }
            break;
          }

          case 'tool_call':
            patchAssistant((prev) => ({
              toolCalls: [
                ...(prev.toolCalls ?? []),
                {
                  id: ev.id,
                  name: ev.name,
                  arguments: ev.arguments,
                  status: 'running',
                },
              ],
            }));
            break;

          case 'tool_result':
            patchAssistant((prev) => ({
              toolCalls: (prev.toolCalls ?? []).map((tc) =>
                tc.id === ev.id
                  ? {
                      ...tc,
                      status: ev.output?.startsWith?.('"error"') ? 'error' : 'complete',
                      output: ev.output,
                      durationMs: ev.durationMs,
                    }
                  : tc,
              ),
            }));
            break;

          case 'usage':
            patchAssistant({
              usage: {
                promptTokens:     ev.promptTokens,
                completionTokens: ev.completionTokens,
                totalTokens:      ev.promptTokens + ev.completionTokens,
              },
            });
            break;

          case 'done':
            // Flush any leftover buffer to the appropriate lane.
            const tail = flushThinking(think);
            if (tail.visible) {
              patchAssistant((prev) => ({
                content: (prev.content ?? '') + tail.visible,
              }));
            }
            if (tail.thinking) {
              patchAssistant((prev) => ({
                thinking: (prev.thinking ?? '') + tail.thinking,
              }));
            }
            patchAssistant({ status: 'done' });
            break;

          case 'error':
            patchAssistant({
              status: 'error',
              content: (assistantMsg.content || '') + (ev.message ? '\n\n' + ev.message : ''),
            });
            break;
        }
      }
    } catch (err) {
      // AbortError is a normal cancellation, not a UI error.
      if (err?.name === 'AbortError') {
        patchAssistant({ status: 'done' });
      } else {
        patchAssistant({ status: 'error', content: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const reset = () => {
    setMessages([]);
    setConversationId(null);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open AI agent"
          data-testid="agent-fab"
          aria-hidden={hideFab ? 'true' : undefined}
          tabIndex={hideFab ? -1 : undefined}
          className={cn(
            'fixed bottom-12 right-4 z-40 flex size-12 items-center justify-center rounded-full',
            'bg-reef text-reef-foreground shadow-lg ring-1 ring-foreground/10',
            'transition-transform hover:scale-105 focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            open && 'rotate-12',
            hideFab && 'pointer-events-none hidden',
          )}
        >
          <Bot className="size-5" />
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-positive shadow-[0_0_0_3px_var(--background)]" />
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex h-full w-full max-w-md flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="flex flex-row items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* Square bot avatar w/ live-status pulse on the bottom-right
                corner so the user can tell at a glance that the agent
                is online. Sits flush with the header so the agent
                profile reads "own" rather than "decorative". */}
            <div
              className="relative flex size-10 shrink-0 items-center justify-center bg-reef text-reef-foreground"
              aria-hidden
            >
              <Bot className="size-5" />
              <span
                className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-positive shadow-[0_0_0_2px_var(--card)]"
                data-testid="agent-status-dot"
              />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base leading-tight">SeaSID Agent</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs leading-snug">
                <span className="font-mono text-foreground">{siteKey}</span>
                <span className="mx-1 text-muted-foreground/50">·</span>
                7 tools · live briefing
              </SheetDescription>
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={reset}
                aria-label="Reset conversation"
                data-testid="agent-reset"
                disabled={messages.length === 0}
              >
                <RotateCcw className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset conversation</TooltipContent>
          </Tooltip>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-background px-5 py-4"
          data-testid="agent-transcript"
        >
          {messages.length === 0 && !busy ? (
            <EmptyState siteKey={siteKey} />
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <Message key={i} message={m} />
              ))}
              {busy && (
                <div
                  className="flex items-center gap-2 pl-1.5 text-xs text-muted-foreground"
                  data-testid="agent-busy"
                >
                  <StreamingDots />
                  <span>Agent thinking…</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ask about a site, conditions, alerts…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
              data-testid="agent-input"
              className="flex-1"
            />
            <Button
              onClick={send}
              disabled={busy || draft.trim() === ''}
              size="icon"
              data-testid="agent-send"
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Enter to send · Shift+Enter for newline</span>
            {conversationId && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {String(conversationId).slice(0, 8)}
              </Badge>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState({ siteKey }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-reef/10 text-reef">
        <Bot className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No conversation yet</p>
        <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">
          Ask for a briefing, conditions check, or run any of the 7 agent tools.
          Site pinned to <span className="font-mono text-foreground">{siteKey}</span>.
        </p>
      </div>
      <div className="grid gap-1.5 text-left text-xs">
        {PROMPTS.map((p) => (
          <span
            key={p}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-muted-foreground"
          >
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

export default AgentFab;
export { AgentFab };
