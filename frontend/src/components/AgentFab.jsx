import { useEffect, useRef, useState } from 'react';
import { Bot, Send, RotateCcw, MapPin, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SiteSelector } from '@/components/SiteSelector';
import { cn } from '@/lib/utils';
import { api, streamChat } from '@/api';
import MarkdownResponse from './MarkdownResponse';
import { Message } from './agent/Message';
import { StreamingDots } from './agent/StreamingDots';
import ChatComposer from './agent/ChatComposer';
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
 * Roadmap #10 polish (roadmap next-move backlog):
 *  - Suggested prompts render as real <button>s that populate + send.
 *  - Site context is visible + changeable inside the Sheet header via
 *    SiteSelector (defaults to initialSiteKey from props).
 *  - Composer hint matches actual behaviour: single-line <Input>, Enter
 *    sends, Shift+Enter does NOT insert a newline (the previous hint
 *    promised multiline support that did not exist).
 *  - Reset confirms via window.confirm when the transcript is non-empty,
 *    so a fat-finger click cannot wipe an in-progress conversation.
 */
const PROMPTS = [
  'Should I dive at the current site tomorrow morning?',
  'Compare current conditions across both sites.',
  'Generate a one-page safety briefing for the current site.',
];

function AgentFab({ initialSiteKey = 'dauin_muck' }) {
  const [open, setOpen] = useState(false);
  const [siteKey, setSiteKey] = useState(initialSiteKey);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const scrollRef = useRef(null);
  // Holds the AbortController for the in-flight stream so the Stop
  // button (or an unmount) can cancel it. We keep this at the FAB
  // level rather than inside the send closure so the composer can
  // access it without us having to thread it through props.
  const controllerRef = useRef(null);
  // Composer ref so we can pull focus into the textarea when the
  // sheet opens, when a stream finishes, or after a reset — without
  // the operator having to click back into the field to type the
  // follow-up. See ChatComposer.forwardRef.
  const composerRef = useRef(null);

  // External trigger from CommandPalette (and any in-page "Open agent"
  // button that wants to summon the FAB).
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('seasid:open-agent', handler);
    return () => window.removeEventListener('seasid:open-agent', handler);
  }, []);

  // Auto-focus the textarea whenever the sheet opens or the FAB mounts.
  // The Sheet mounts the composer lazily on first open, so we can't
  // just call .focus() at FAB mount time — the composer ref doesn't
  // exist yet. Watching `open` and deferring to the next frame gives
  // Radix time to mount the SheetContent + composer before we focus.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Auto-scroll transcript on new content
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  /**
   * Core send routine — pushes the user + assistant placeholders,
   * opens the SSE stream, and patches the assistant message as events
   * arrive. Exposed via ref so clickable prompt buttons can call it
   * without re-rendering the FAB.
   */
  const sendRef = useRef(async (text) => {
    const userMsg = { id: newMessageId(), role: 'user', content: text };
    const assistantMsg = {
      id: newMessageId(),
      role: 'assistant',
      content: '',
      thinking: '',
      toolCalls: [],
      status: 'streaming',
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setDraft('');
    setBusy(true);

    const controller = new AbortController();
    controllerRef.current = controller;
    const think = makeThinkingState();

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

          case 'done': {
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
          }

          case 'error':
            patchAssistant({
              status: 'error',
              content: (assistantMsg.content || '') + (ev.message ? '\n\n' + ev.message : ''),
            });
            break;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        patchAssistant({ status: 'done' });
      } else {
        patchAssistant({ status: 'error', content: err.message });
      }
    } finally {
      setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
      // Pull focus back into the textarea so the operator can type
      // the follow-up without clicking. The composer's focus() queues
      // a microtask if the textarea is still disabled from the
      // previous render, so this works whether React has committed
      // the disabled=false yet or not.
      composerRef.current?.focus();
    }
  });

  // Keep the ref pointing at the latest closure so prompt buttons stay
  // in sync without re-rendering them.
  const send = (text) => {
    const t = (text ?? draft).trim();
    if (!t || busy) return;
    return sendRef.current(t);
  };

  const stop = () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  };

  // Best-effort cleanup on unmount so a stream that outlives the
  // component doesn't keep the network connection open.
  useEffect(() => {
    return () => {
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const reset = () => {
    // Confirm before discarding a non-empty transcript (roadmap #10).
    // Empty transcripts skip the dialog so accidental clicks don't
    // interrupt the user with a stray confirmation.
    if (messages.length > 0) {
      setResetDialogOpen(true);
      return;
    }
    setMessages([]);
    setConversationId(null);
  };

  const confirmReset = () => {
    setMessages([]);
    setConversationId(null);
    setResetDialogOpen(false);
    // Refocus so the operator can immediately start a fresh thread.
    // The requestAnimationFrame defers until Radix has closed the
    // confirm dialog and the textarea is back in the DOM focus order.
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open AI agent"
          data-testid="agent-fab"
          className={cn(
            'fixed bottom-12 right-4 z-40 flex size-12 items-center justify-center rounded-full',
            'bg-reef text-reef-foreground shadow-lg ring-1 ring-foreground/10',
            'transition-transform hover:scale-105 focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            open && 'rotate-12',
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
        <SheetHeader className="flex flex-col gap-3 border-b border-border bg-card px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
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
              <TooltipContent side="bottom">
                {messages.length === 0 ? 'Nothing to reset' : 'Reset conversation'}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Site context selector (roadmap #10): visible + changeable
              inside the Sheet so the user always knows which site the
              next prompt will be sent against. */}
          <div className="flex items-center gap-2" data-testid="agent-site-context">
            <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              Site
            </span>
            <div className="min-w-0 flex-1">
              <SiteSelector
                value={siteKey}
                onChange={setSiteKey}
                ariaLabel="Agent site context"
                id="agent-site-selector"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-background px-5 py-4"
          data-testid="agent-transcript"
        >
          {messages.length === 0 && !busy ? (
            <EmptyState siteKey={siteKey} onPickPrompt={send} disabled={busy} />
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
          <ChatComposer
            ref={composerRef}
            value={draft}
            onChange={setDraft}
            onSend={(overrideText) => send(overrideText)}
            onStop={stop}
            busy={busy}
            siteKey={siteKey}
            suggestions={
              // Inline suggestion chips are most useful at the start of
              // a conversation; once the user is mid-thread the chips
              // become noise, so we hide them after the first turn.
              messages.length === 0 ? personalisedPrompts() : []
            }
            placeholder={`Ask the agent about ${siteKey}…`}
          />
        </div>
      </SheetContent>
    </Sheet>
    <ConfirmDialog
      open={resetDialogOpen}
      onOpenChange={setResetDialogOpen}
      title="Discard the current conversation?"
      description="This clears every message in this agent thread. It cannot be undone."
      confirmLabel="Discard"
      cancelLabel="Keep conversation"
      tone="danger"
      onConfirm={confirmReset}
    />
    </>
  );
}

/**
 * Build the prompt-chip list, personalising the "current site" string
 * to the actual selected site. Kept outside the component so the
 * substitution runs only on render and doesn't recreate strings on
 * every keystroke.
 */
function personalisedPrompts() {
  return PROMPTS;
}

function EmptyState({ siteKey, onPickPrompt, disabled }) {
  // Personalise the prompts so the user knows the suggested questions
  // apply to the currently selected site (visible in the header above).
  const personalised = PROMPTS.map((p) =>
    p.replace('the current site', siteKey).replace('across both sites', 'across both sites'),
  );

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
      <div className="grid w-full gap-1.5 text-left text-xs">
        {personalised.map((p, i) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPickPrompt(p)}
            disabled={disabled}
            data-testid={`agent-prompt-${i}`}
            className="h-auto justify-start whitespace-normal px-2.5 py-2 text-left font-normal"
          >
            {p}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default AgentFab;
export { AgentFab };
