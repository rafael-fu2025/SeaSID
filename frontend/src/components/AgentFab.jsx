import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';
import { BrainIcon, SendIcon, RefreshIcon, XIcon } from './icons';
import MarkdownResponse from './MarkdownResponse';

/**
 * AgentFab — Floating Action Button + popover chat for the SeaSID AI agent.
 *
 * Behavior:
 *  - Renders a circular pill FAB in the lower-right of every page.
 *  - Clicking the FAB toggles the popover; second click or outside-click closes it.
 *  - Popover is a 400 × 560 mini-chat that talks to POST /api/v1/agent/chat.
 *  - Site context is captured from the SiteContext (best-effort) or falls back
 *    to the first registered site.
 *  - Conversation ID is kept across open/close cycles; "reset" clears history.
 */
const PROMPTS = [
  'Should I dive at Dauin tomorrow morning?',
  'Compare current conditions across both sites.',
  'Generate a one-page safety briefing for Apo Island.',
];

const fmtClock = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export default function AgentFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError] = useState(null);
  const [sites, setSites] = useState([]);
  const [siteKey, setSiteKey] = useState('dauin_muck');
  const transcriptRef = useRef(null);
  const popoverRef = useRef(null);
  const fabRef = useRef(null);

  // Load sites once for the selector in the header.
  useEffect(() => {
    let cancel = false;
    api.getSites()
      .then((s) => {
        if (cancel) return;
        setSites(s || []);
        if (s?.length && !s.find((x) => x.key === siteKey)) setSiteKey(s[0].key);
      })
      .catch(() => {});
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll transcript on new message.
  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, loading]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Close on outside click (but not when clicking the FAB itself).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const inPopover = popoverRef.current?.contains(e.target);
      const onFab = fabRef.current?.contains(e.target);
      if (!inPopover && !onFab) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const send = useCallback(async (text) => {
    const userMsg = (text ?? input).trim();
    if (!userMsg || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg, ts: new Date().toISOString() }]);
    setLoading(true);
    setError(null);
    try {
      const result = await api.chat(userMsg, conversationId, siteKey);
      setConversationId(result.conversation_id);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.response,
          toolCalls: result.tool_calls,
          ts: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '⚠️ ' + err.message,
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, conversationId, siteKey]);

  const handleSubmit = (e) => {
    e.preventDefault();
    send();
  };

  const reset = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  return (
    <>
      {open && (
        <div
          ref={popoverRef}
          className="chat-popover"
          role="dialog"
          aria-modal="false"
          aria-labelledby="fab-chat-title"
          data-testid="agent-popover"
        >
          {/* Header */}
          <header className="chat-popover__header">
            <div className="chat-popover__title">
              <div className="chat-popover__avatar" aria-hidden>
                <BrainIcon size={16} />
              </div>
              <div>
                <div id="fab-chat-title" className="chat-popover__title-text">SeaSID Agent</div>
                <div className="chat-popover__sub">
                  {sites.length > 0 ? (
                    <select
                      aria-label="Site context"
                      value={siteKey}
                      onChange={(e) => setSiteKey(e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-tertiary)',
                        font: 'inherit',
                        fontSize: 'var(--text-xs)',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      {sites.map((s) => (
                        <option key={s.key} value={s.key} style={{ color: 'var(--text-primary)', background: 'var(--surface-3)' }}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>no site selected</>
                  )}
                </div>
              </div>
            </div>
            <div className="chat-popover__actions">
              <button
                className="chat-popover__iconbtn"
                aria-label="Reset conversation"
                onClick={reset}
                disabled={!messages.length}
                title="Reset conversation"
              >
                <RefreshIcon size={14} />
              </button>
              <button
                className="chat-popover__iconbtn chat-popover__iconbtn--close"
                aria-label="Close"
                onClick={() => setOpen(false)}
                title="Close (Esc)"
              >
                <XIcon size={14} />
              </button>
            </div>
          </header>

          {/* Transcript */}
          <div className="chat-popover__transcript" ref={transcriptRef}>
            {messages.length === 0 ? (
              <div className="chat-popover__empty">
                <div className="chat-popover__empty-mark"><BrainIcon size={20} /></div>
                <div className="chat-popover__empty-title">How can I help?</div>
                <p>Ask about conditions, generate a briefing, or compare sites. Live data is fetched automatically.</p>
                <div className="chat-popover__empty-prompts">
                  {PROMPTS.map((p) => (
                    <button
                      key={p}
                      className="chat-popover__empty-prompt"
                      onClick={() => send(p)}
                      data-testid={`prompt-${p.slice(0, 12).replace(/\s+/g, '-')}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <Bubble key={i} message={m} />)
            )}
            {loading && (
              <div className="chat-popover__msg chat-popover__msg--assistant">
                <div className="chat-popover__msg-avatar chat-popover__msg-avatar--assistant">
                  <BrainIcon size={12} />
                </div>
                <div>
                  <div className="chat-popover__bubble">
                    <span className="chat-popover__typing">
                      <span className="chat-popover__typing-dots">
                        <span /><span /><span />
                      </span>
                      <span>Analyzing conditions…</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <form className="chat-popover__composer" onSubmit={handleSubmit}>
            <textarea
              className="chat-popover__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={`Ask about ${siteKey === 'dauin_muck' ? 'Dauin Muck' : 'Apo Reef'} conditions…`}
              disabled={loading}
              rows={1}
              aria-label="Message"
              data-testid="fab-chat-input"
            />
            <button
              type="submit"
              className="chat-popover__send"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              data-testid="fab-chat-send"
            >
              {loading ? <span className="spinner" style={{ borderTopColor: 'currentColor' }} /> : <SendIcon size={14} />}
            </button>
          </form>
        </div>
      )}

      {/* The actual floating button */}
      <button
        ref={fabRef}
        type="button"
        className="fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="fab-chat"
        aria-label={open ? 'Close agent chat' : 'Open agent chat'}
        title={open ? 'Close agent chat' : 'SeaSID Agent'}
        data-testid="agent-fab"
      >
        <span className="fab__icon" aria-hidden>
          {open ? <XIcon size={18} /> : <BrainIcon size={18} />}
        </span>
        <span className="fab__dot" aria-hidden />
        <span className="fab__label">{open ? 'Close' : 'Ask SeaSID'}</span>
      </button>
    </>
  );
}

function Bubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`chat-popover__msg chat-popover__msg--${message.role}`}>
      <div className={`chat-popover__msg-avatar ${isUser ? '' : 'chat-popover__msg-avatar--assistant'}`}>
        {isUser ? 'You' : <BrainIcon size={12} />}
      </div>
      <div>
        <div className="chat-popover__bubble">
          {isUser ? (
            <span>{message.content}</span>
          ) : (
            <MarkdownResponse dense>{message.content}</MarkdownResponse>
          )}
        </div>
        <div className="chat-popover__meta">
          <span>{fmtClock(message.ts)}</span>
          {message.toolCalls?.length > 0 && (
            <span>tools: {message.toolCalls.map((t) => t.name).join(', ')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
