import { Bot, AlertTriangle, User, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import MarkdownResponse from '@/components/MarkdownResponse';
import { ToolCallGroup } from './ToolCallGroup';
import { ThinkingBlock } from './ThinkingBlock';

/**
 * Message — single bubble in the agent transcript.
 *
 * Composition matches the user's reference (minimax_cb's
 * `<ChatMessage>`):
 *   1. Header (sender avatar + name + optional meta badge)
 *   2. Tool calls (`<ToolCallGroup>` collapses 1+ call into a card lane)
 *   3. Thinking (`<ThinkingBlock>` — collapsible, default closed)
 *   4. Body (the assistant's actual answer, rendered as Markdown)
 *   5. Hidden response body while the answer is in flight but the first
 *      delta hasn't arrived yet. The "Agent thinking…" row in AgentFab
 *      owns the loading indicator so the wave.gif only loads once.
 *
 * Variants:
 *   - `role: "user"`      → right-aligned-ish, neutral card
 *   - `role: "assistant"` → left-aligned, reef-tinted card
 *   - `role: "error"`     → danger-tinted, no markdown
 */
export function Message({ message }) {
  if (!message) return null;
  const role = message.role ?? 'assistant';
  if (role === 'user')   return <UserMessage message={message} />;
  if (role === 'error')  return <ErrorMessage message={message} />;
  return <AssistantMessage message={message} />;
}

function UserMessage({ message }) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const hasContent = typeof message.content === 'string' && message.content.length > 0;
  return (
    <div
      className="flex flex-col items-end gap-1"
      data-testid="message-user"
    >
      <header className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>You</span>
        <User className="size-3" />
      </header>
      {attachments.length > 0 && (
        <div
          className="flex max-w-[88%] flex-wrap justify-end gap-2"
          data-testid="message-user-attachments"
        >
          {attachments.map((a, i) =>
            a.kind === 'image' && a.url ? (
              <img
                key={i}
                src={a.url}
                alt={a.name || 'attachment'}
                className="size-24 rounded-md border border-border object-cover"
              />
            ) : (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground"
                title={a.name}
              >
                <FileText className="size-3 shrink-0" />
                <span className="max-w-[12rem] truncate">{a.name}</span>
              </span>
            ),
          )}
        </div>
      )}
      {hasContent && (
        <div className="max-w-[88%] whitespace-pre-wrap break-words border border-border bg-card p-2.5 text-sm text-foreground">
          {message.content}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ message }) {
  const isStreaming = message.status === 'streaming';
  const hasToolCalls = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
  const hasThinking  = typeof message.thinking === 'string' && message.thinking.trim().length > 0;
  const hasContent   = typeof message.content  === 'string' && message.content.length > 0;
  // Hide the response bubble entirely while the agent is still waiting
  // for the first stream chunk. The "Agent thinking…" row that lives in
  // AgentFab renders the only loading indicator, which avoids loading
  // the wave.gif twice (one inside this placeholder + one in the row).
  const isPlaceholderState = isStreaming && !hasContent && !hasToolCalls;

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid="message-assistant"
      data-streaming={isStreaming}
    >
      <header className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-reef">
        <div className="flex size-4 items-center justify-center bg-reef text-reef-foreground">
          <Bot className="size-2.5" />
        </div>
        <span className="font-medium">Agent</span>
        {hasToolCalls && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            · {message.toolCalls.length} tool{message.toolCalls.length === 1 ? '' : 's'}
          </span>
        )}
        {message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground" data-testid="message-toolcount-legacy">
            (legacy: {message.tool_calls.length})
          </span>
        )}
      </header>

      {hasToolCalls && (
        <div className="w-full max-w-full">
          <ToolCallGroup calls={message.toolCalls} />
        </div>
      )}

      {hasThinking && (
        <div className="w-full max-w-full">
          <ThinkingBlock>{message.thinking}</ThinkingBlock>
        </div>
      )}

      {!isPlaceholderState && (
        <div
          className={cn(
            'w-full border bg-reef/5 p-3 text-xs text-foreground',
            'border-reef/30',
          )}
          data-testid="message-assistant-body"
        >
          <MarkdownResponse size="xs">{message.content ?? ''}</MarkdownResponse>
        </div>
      )}
    </div>
  );
}

function ErrorMessage({ message }) {
  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid="message-error"
      role="alert"
    >
      <header className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-danger">
        <AlertTriangle className="size-3" />
        <span>Error</span>
      </header>
      <div className="max-w-[88%] border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">
        {message.content ?? 'Something went wrong.'}
      </div>
    </div>
  );
}
