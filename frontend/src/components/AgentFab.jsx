import { useEffect, useRef, useState } from 'react';
import { Bot, Send, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { api } from '@/api';
import MarkdownResponse from './MarkdownResponse';

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

  // External trigger from CommandPalette
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('seasid:open-agent', handler);
    return () => window.removeEventListener('seasid:open-agent', handler);
  }, []);

  // Auto-scroll transcript on new content
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const res = await api.chat(text, conversationId, siteKey);
      setConversationId(res.conversation_id || conversationId);
      setMessages([...next, {
        role: 'assistant',
        content: res.response || '_(no response)_',
        tool_calls: res.tool_calls,
      }]);
    } catch (err) {
      setMessages([...next, { role: 'error', content: err.message }]);
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
        className="flex h-full w-full max-w-md flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="flex flex-row items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-reef text-reef-foreground">
              <Bot className="size-4" />
            </div>
            <div>
              <SheetTitle className="text-base">SeaSID Agent</SheetTitle>
              <SheetDescription className="text-xs">
                AI briefing · 7 tools · live for <span className="font-mono">{siteKey}</span>
              </SheetDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={reset}
            aria-label="Reset conversation"
            data-testid="agent-reset"
            disabled={messages.length === 0}
          >
            <RefreshCw className="size-3.5" />
          </Button>
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
                <Message key={i} role={m.role} content={m.content} toolCalls={m.tool_calls} />
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Skeleton className="size-3 rounded-full" />
                  <Skeleton className="h-3 w-16" />
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

function Message({ role, content, toolCalls }) {
  if (role === 'error') {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
        {content}
      </div>
    );
  }
  if (role === 'user') {
    return (
      <div className="rounded-md border border-border bg-card p-3">
        <div className="text-xs font-medium text-muted-foreground">You</div>
        <div className="mt-1 text-sm text-foreground">{content}</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-reef/30 bg-reef/5 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-reef">Agent</div>
        {toolCalls && toolCalls.length > 0 && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {toolCalls.length} tool{toolCalls.length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      <div className="mt-1.5">
        <MarkdownResponse>{content}</MarkdownResponse>
      </div>
    </div>
  );
}

export default AgentFab;
export { AgentFab };
