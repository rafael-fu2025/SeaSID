import { useEffect, useRef, useState } from 'react';
import { Bot, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useTheme } from '@/theme/ThemeContext';
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

// Text-like documents are read as plain text and inlined into the prompt
// server-side; binary formats (pdf/doc) are intentionally out of scope.
const TEXT_DOC_RE = /\.(txt|csv|md|markdown|json|log|tsv|ya?ml)$/i;
function isTextLikeAttachment(mime, name) {
  if (mime?.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  return TEXT_DOC_RE.test(name || '');
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * AgentFab — floating AI assistant.
 *
 * Roadmap #10 polish (roadmap next-move backlog):
 *  - Site context is visible + changeable inside the Sheet header via
 *    SiteSelector (defaults to initialSiteKey from props).
 *  - Composer hint matches actual behaviour: single-line <Input>, Enter
 *    sends, Shift+Enter does NOT insert a newline (the previous hint
 *    promised multiline support that did not exist).
 *  - Reset confirms via window.confirm when the transcript is non-empty,
 *    so a fat-finger click cannot wipe an in-progress conversation.
 */

function AgentFab({ initialSiteKey = 'dauin_muck' }) {
  const [open, setOpen] = useState(false);
  const [siteKey, setSiteKey] = useState(initialSiteKey);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [sites, setSites] = useState([]);
  const [isSiteMenuOpen, setIsSiteMenuOpen] = useState(false);
  const siteMenuRef = useRef(null);
  const { theme } = useTheme();
  // Use the squared favicon family to mirror the brand mark used in the
  // sidebar, swapping to the lighter variant in dark theme.
  const brandIcon = theme === 'dark' ? '/seasid_1x1-light.png' : '/seasid_1x1.png';
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

  // Pull the registered sites so the native popover can list them.
  useEffect(() => {
    let cancelled = false;
    api.getSites()
      .then((rows) => {
        if (!cancelled) setSites(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setSites([]);
      });
    return () => { cancelled = true; };
  }, []);

  // Close the site picker when the operator clicks anywhere else.
  useEffect(() => {
    if (!isSiteMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (siteMenuRef.current && !siteMenuRef.current.contains(event.target)) {
        setIsSiteMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [isSiteMenuOpen]);

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
  const sendRef = useRef(async (text, attachments = []) => {
    // Read attached files: images become base64 data URLs for the
    // multimodal model, text documents are read as plain text and
    // inlined server-side. `display` mirrors what we render in the
    // user's bubble (image thumbnails + document chips).
    const images = [];
    const documents = [];
    const display = [];
    for (const a of attachments) {
      if (a.kind === 'image') {
        try {
          const dataUrl = await readFileAsDataURL(a.file);
          images.push({ data_url: dataUrl, name: a.name });
          display.push({ kind: 'image', name: a.name, url: dataUrl });
        } catch { /* skip unreadable image */ }
      } else if (isTextLikeAttachment(a.mime, a.name)) {
        try {
          const textContent = await readFileAsText(a.file);
          documents.push({ name: a.name, text: textContent });
          display.push({ kind: a.kind, name: a.name });
        } catch { /* skip unreadable document */ }
      }
    }

    // Fall back to a neutral prompt when the operator sent only files so
    // the backend (message min_length=1) still accepts the turn.
    const messageText =
      text || (images.length || documents.length ? 'Please review the attached file(s).' : '');

    const userMsg = {
      id: newMessageId(),
      role: 'user',
      content: messageText,
      attachments: display,
    };
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
        message: messageText,
        conversationId,
        siteKey,
        images,
        documents,
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
  const send = (text, attachments = []) => {
    const t = (text ?? draft).trim();
    if ((!t && attachments.length === 0) || busy) return;
    return sendRef.current(t, attachments);
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
        className="flex h-full w-full max-w-md flex-col gap-0 overflow-visible p-0 sm:max-w-md"
      >
        <SheetHeader className="flex flex-col gap-3 border-b border-border bg-card px-5 py-4">
          {/* Brand + title + reset + site picker all share one row so the
              operator can change the active site without scanning back to
              a second row beneath the title. */}
          <div className="flex items-center gap-2">
            <img
              src={brandIcon}
              alt=""
              aria-hidden
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-md object-contain"
            />
            <SheetTitle className="text-base leading-tight">SeaSID Agent</SheetTitle>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-8 shrink-0"
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

            <div className="relative w-32 shrink-0" ref={siteMenuRef}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isSiteMenuOpen}
                data-testid="agent-site-selector"
                onClick={() => setIsSiteMenuOpen((value) => !value)}
                className="flex h-8 w-full items-center gap-2 truncate rounded-md border border-input bg-background px-2.5 text-xs text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate font-mono">{siteKey}</span>
              </button>
              {isSiteMenuOpen && sites && sites.length > 0 && (
                <div
                  role="menu"
                  aria-label="Select dive site"
                  className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  {sites.map((site) => (
                    <button
                      key={site.key}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSiteKey(site.key);
                        setIsSiteMenuOpen(false);
                      }}
                      data-testid={`site-option-${site.key}`}
                      className={cn(
                        'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground',
                        site.key === siteKey && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="inline-block size-1.5 rounded-full bg-foreground/40" />
                      <span className="flex-1 truncate">{site.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {site.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-background px-5 py-4"
          data-testid="agent-transcript"
        >
          {messages.length === 0 && !busy ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center"
              data-testid="agent-empty-state"
            >
              <img
                src="/diver.gif"
                alt=""
                aria-hidden
                width={128}
                height={128}
                className="size-32 rounded-lg object-contain"
              />
              <div>
                <p className="text-sm font-medium text-foreground">No conversation yet</p>
                <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">
                  Ask for a briefing, conditions check, or run any of the 7 agent tools.
                  Site pinned to <span className="font-mono text-foreground">{siteKey}</span>.
                </p>
              </div>
            </div>
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

        <div className="bg-background p-3">
          <ChatComposer
            ref={composerRef}
            value={draft}
            onChange={setDraft}
            onSend={(attachments) => send(undefined, attachments)}
            onStop={stop}
            busy={busy}
            siteKey={siteKey}
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

export default AgentFab;
export { AgentFab };
