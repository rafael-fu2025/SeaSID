# F5 — Agent Chat UI Audit: AgentFab, Agent page, ChatComposer, Message, MarkdownResponse, ToolCall* , ThinkingBlock, StreamingDots, streaming-thinking

> Audited 2026-09-19 · ~1,830 lines · Lens: LLM-chat UX patterns, untrusted-output rendering, streaming correctness

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `frontend/src/components/AgentFab.jsx` | 547 | FAB + Sheet chat shell, SSE consumption, attachments |
| `frontend/src/components/agent/ChatComposer.jsx` | 493 | Input, attachment picker, send/stop, focus management |
| `frontend/src/components/agent/ToolCallRow.jsx` | 196 | Per-call status/output rendering (with JSON tree) |
| `frontend/src/pages/Agent.jsx` | 17 | Full-page route wrapping the same chat (thin) |
| `frontend/src/components/agent/Message.jsx` | 157 | User/assistant bubbles, attachments, thinking lane |
| `frontend/src/components/MarkdownResponse.jsx` | 146 | react-markdown + emoji/think stripping + token styling |
| `frontend/src/components/agent/streaming-thinking.js` | 113 | `<think>` hold-back state machine |
| `frontend/src/components/agent/ToolCallGroup.jsx` | 63 | Grouping header |
| `frontend/src/components/agent/ThinkingBlock.jsx` | 54 | Collapsible reasoning lane |
| `frontend/src/components/agent/StreamingDots.jsx` | 30 | Typing indicator |

---

## 2. How it works

`AgentFab` consumes `streamChat`'s async iterator and folds events into per-message state: `text` deltas pass through the `streaming-thinking` state machine (which holds back partial `<think>` tags across chunk boundaries), `tool_call`/`tool_result` events patch a per-call list (running → complete/error with duration), `usage` captures token counts, `done` flushes the thinking tail. Attachments: images → base64 data URLs; text-like files → inline text (PDF/doc deliberately excluded). AbortController powers the Stop button and unmount cleanup. Reset confirms via ConfirmDialog when the transcript is non-empty. Markdown output renders through `MarkdownResponse` (react-markdown **without** `rehype-raw` → raw HTML escaped by default) after a `sanitizeModelOutput` pass that strips emoji pictographs and `<think>` blocks client-side (mirroring the backend's strip — defense in depth).

---

## 3. Findings

### P1 — High

**F-F5-01 · Tool-error detection never matches** — `AgentFab.jsx:263`: `status: ev.output?.startsWith?.('"error"') ? 'error' : 'complete'`. Backend tool handlers return `json.dumps({"error": …})`, i.e. a string starting with `{"` — never `"error"`. Every failed tool call therefore renders with a green "complete" status; operators can't distinguish "the agent read real data" from "the agent got an error and improvised". Parse the JSON (`JSON.parse(ev.output)` → check `.error` / `reason`) before assigning status.

**F-F5-02 · The Settings tool-toggles this UI implies don't exist** — cross-ref F-F4-01: the composer placeholder and empty state advertise tool control ("run any of the 7 agent tools", site pinned), but the disable switches are inert. Until wired, the chat should not suggest per-tool control exists.

### P2 — Medium

**F-F5-03 · Error events discard already-streamed content** — `AgentFab.jsx:298-303` patches `content: (assistantMsg.content || '') + message`, but `assistantMsg` is the *original* object captured in the closure (content always `''`), so an error after 200 streamed tokens replaces them with the bare error. Use the functional patch form (`patchAssistant((prev) => ({ content: (prev.content || '') + … }))`) as the `text` branch already does.
**F-F5-04 · Attachment limits enforced server-side only, silently** — the backend truncates to 4 images / slices documents (`agent.py:175, 184`) and enforces 12 MB/200 k-char caps; the client sends everything and drops nothing. An operator attaching 8 photos watches 4 vanish without feedback. Pre-validate counts/sizes in `ChatComposer` with a toast.
**F-F5-05 · Transcript is lost on refresh, by design but silently** — conversationId lives in component state only; the backend persists history (owner-less — F-B5-02). A "restore last conversation" affordance (the id is deterministic server-side) or at least an explanatory empty-state note would set expectations.
**F-F5-06 · Message list keyed by array index** — `AgentFab.jsx:503` (`key={i}`); with the reset + append-only pattern this works today, but any future insertion/reordering (regenerate-last-answer is the obvious next feature) will mis-patch state. Use the already-generated `newMessageId()`.
**F-F5-07 · Auto-scroll fights the reader** — `AgentFab.jsx:143-146` scrolls to bottom on *every* message patch (each token!). If the operator scrolls up mid-stream to re-read, the next delta yanks them down. Standard fix: only autoscroll when already near-bottom (`scrollHeight - scrollTop - clientHeight < 40`), plus a "jump to latest" pill.

### P3 — Low

**F-F5-08 · `streaming-thinking` can leak a partial tag prefix** — a chunk ending in `<thi` is short enough to bypass the hold-back (`length < 7` emits fully) and the closer chunk completes a tag that's already visible; `stripStrayThinkTags` only removes *whole* tags. Cosmetic; fix by holding back `min(len, 6)` chars unconditionally when the tail could be a prefix.
**F-F5-09 · Custom site menu re-implements a dropdown** — `AgentFab.jsx:429-470` hand-rolls popover/outside-click/aria instead of reusing the Radix `DropdownMenu` used everywhere else (drift + a11y surface).
**F-F5-10 · `usage` events ignore `totalTokens` from the server** — `AgentFab.jsx:272-279` recomputes the sum (fine) but the backend may emit it; trivial.
**F-F5-11 · `MarkdownResponse` strips emoji with `\p{Extended_Pictographic}`** — also strips legitimately meaningful glyphs (⚠️ in the agent's alert quotes); the intent is documented, just note that ⚠→"" loses signal in safety text.
**F-F5-12 · Duplicated `<think>` stripping (backend `strip_internal_thoughts` + frontend sanitize)** — good defense-in-depth, but three regex pairs now exist across `agent.py`, `MarkdownResponse.jsx`, and `streaming-thinking.js`; keep behavior synced (tests exist for the JS side).

---

## 4. Web research (what current best practice says)

1. **Rendering model output** — plain react-markdown (no `rehype-raw`) is the security default: raw HTML is escaped, so prompt-injected `<img onerror>`/`<script>` payloads render inert; only insecure `urlTransform` overrides or raw-HTML plugins open holes — SeaSID uses neither, and its custom `a` renderer adds `rel="noopener noreferrer"` for `target="_blank"` correctly. Sources: [react-markdown — secure by default](https://github.com/remarkjs/react-markdown) · [Escape.tech on chat XSS](https://escape.tech) · [Invicti on React XSS](https://www.invicti.com).
2. **Streaming chat patterns** — the canonical loop is: optimistic user-message append → typing indicator until first token → SSE fold into state → AbortController-backed Stop → markdown rendering; plus near-bottom-only autoscroll and server-side cancellation. SeaSID implements all but near-bottom autoscroll. Sources: [Frontend streaming patterns](https://hellofrontend.com) · [Woyable optimistic UI](https://woyable.com) · [The Prompt Bench — stop semantics](https://thepromptbench.com) · [GigaGPU SSE patterns](https://gigagpu.com).
3. **Tool-call surfacing** — showing arguments, duration, and *honest* status per call is the trust pattern for agentic UIs (the whole point is "what data did the assistant consult?" — which F-F5-01 currently breaks at exactly the failure case).

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Markdown-only rendering of untrusted output (no raw HTML) | ✅ react-markdown, no rehype-raw, noopener links | Met |
| Honest per-tool-call status | Error detection never matches | Major (P1) |
| Stop button aborts the real request | ✅ AbortController through fetch → SSE | Met |
| Near-bottom-only autoscroll | Force-scroll every token | Missing (P2) |
| Client-side attachment validation + feedback | Server truncates silently | Missing (P2) |
| Typing indicator / streaming reveal / error states | ✅ StreamingDots + thinking lane + error bubble | Met |
| Durable message ids for state patching | Index keys | Partial (P3) |
| Focus management (open/reset/stream-end) | ✅ Deliberate rAF-deferred focus flows | Met |

## 6. Recommendations (prioritized)

1. **P1 — Fix tool-status detection** (parse JSON, check `error`/`isError`, render amber "error" state with the message visible).
2. **P2 — Autoscroll guard + functional error patch + client-side attachment limits with feedback.**
3. **P2 — Once Settings toggles are real (F-F4-01), reflect the disabled state in the composer (e.g. dimmed tool chips).**
4. **P3 — Stable message keys; replace the hand-rolled site menu with Radix DropdownMenu; unify think-stripping test fixtures; keep a ⚠ allowlist decision explicit.**

---

### What this area does well (worth keeping)

- `streaming-thinking.js` is a genuinely correct incremental `<think>`-tag state machine with hold-back across chunk boundaries — a subtle problem most implementations get wrong — and it's unit-tested (`streaming-thinking.test.js`).
- The SSE fold (`status/text/tool_call/tool_result/usage/done/error`) mirrors the backend's documented event vocabulary 1:1, with AbortController cleanup on unmount and focus restoration after every terminal state.
- The thinking lane (collapsible `ThinkingBlock` fed by the same stream) gives operators visibility into the model's reasoning without trusting it — the right posture for a safety assistant.
- Attachment handling is honest about scope (text-like only, PDFs excluded by documented decision) and mirrors the server's schema exactly.
- `MarkdownResponse`'s token-driven component map gives tables/code/quotes a consistent design-system look with zero raw HTML — the security default *and* the design goal in one.
