/**
 * streaming-thinking — a small state machine that splits an
 * incrementally-arriving text stream into visible content and
 * `<think>...</think>` content.
 *
 * Usage:
 *   const state = makeThinkingState();
 *   for await (const ev of streamChat({...})) {
 *     if (ev.type === 'text') {
 *       const { visible, thinking } = feedThinking(state, ev.delta);
 *       // ... append to message ...
 *     }
 *   }
 *   const tail = flushThinking(state);
 *   // ... append tail ...
 *
 * The hold-back logic is the subtle bit: when `in-think === false`, we
 * hold back up to `<think>`.length - 1 characters so a future delta
 * starting with `<think>` is recognised as a boundary rather than
 * being emitted as plain text. Crucially, we only hold back when the
 * text is *long enough* for a boundary to be possible — short input
 * like "hello" is emitted in full.
 *
 * Ported from minimax_cb's `useChat.ts`, with the boundary-edge fix
 * above (the upstream version held back unconditionally, which leaks
 * short strings into the buffer and emits nothing visible).
 */

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export function makeThinkingState() {
  return { inThink: false, buffer: '' };
}

/**
 * Strip any <think> / </think> literals that somehow end up in the
 * visible stream (defensive — should be unreachable because the state
 * machine pulls them into the thinking lane).
 */
function stripStrayThinkTags(s) {
  return s.replaceAll('<think>', '').replaceAll('</think>', '');
}

/**
 * Feed a delta into the state machine. Returns the new visible +
 * thinking slices to append to the message.
 */
export function feedThinking(state, delta) {
  if (!delta) return { visible: '', thinking: '' };
  let text = state.buffer + delta;
  let visible = '';
  let thinking = '';

  while (text.length > 0) {
    if (state.inThink) {
      const closeIdx = text.indexOf(THINK_CLOSE);
      if (closeIdx === -1) {
        // Hold back up to (THINK_CLOSE.length - 1) chars so a partial
        // `</think` doesn't leak into the thinking lane. Emit everything
        // else.
        const keep = Math.min(text.length, THINK_CLOSE.length - 1);
        thinking += text.slice(0, text.length - keep);
        state.buffer = text.slice(text.length - keep);
        break;
      }
      thinking += text.slice(0, closeIdx);
      text = text.slice(closeIdx + THINK_CLOSE.length);
      state.inThink = false;
      // Drain the hold-back buffer now that the in-think lane is
      // closed — without this, the held-back bytes re-attach to the
      // next chunk's text and leak into visible.
      state.buffer = '';
    } else {
      const openIdx = text.indexOf(THINK_OPEN);
      if (openIdx === -1) {
        // Hold back enough to detect a <think> spanning into the next
        // delta, but only when text is long enough for a boundary to
        // form. Short text is emitted in full.
        if (text.length < THINK_OPEN.length) {
          visible += text;
          state.buffer = '';
        } else {
          const keep = THINK_OPEN.length - 1;
          visible += text.slice(0, text.length - keep);
          state.buffer = text.slice(text.length - keep);
        }
        break;
      }
      visible += text.slice(0, openIdx);
      text = text.slice(openIdx + THINK_OPEN.length);
      state.inThink = true;
    }
  }

  return {
    visible: stripStrayThinkTags(visible),
    thinking: stripStrayThinkTags(thinking),
  };
}

/**
 * Flush whatever's left in the buffer at end-of-stream.
 * If we were mid-think, the leftover is treated as thinking content.
 * Otherwise it's visible.
 */
export function flushThinking(state) {
  const tail = state.buffer;
  state.buffer = '';
  if (!tail) return { visible: '', thinking: '' };
  if (state.inThink) return { visible: '', thinking: tail };
  return { visible: tail, thinking: '' };
}
