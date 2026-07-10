import { describe, it, expect } from 'vitest';
import {
  makeThinkingState, feedThinking, flushThinking,
} from '@/components/agent/streaming-thinking';

describe('streaming-thinking state machine', () => {
  it('emits short plain text (length < <think>) in full', () => {
    // Text shorter than `<think>` can never start a think block, so
    // the state machine emits everything in one go.
    const s = makeThinkingState();
    expect(feedThinking(s, 'hello').visible).toBe('hello');
    expect(feedThinking(s, '').visible).toBe('');
    expect(feedThinking(s, 'a').visible).toBe('a');
  });

  it('holds back <think>.length - 1 chars of a longer plain-text chunk', () => {
    // The next delta could start a think block, so the last 6 chars
    // stay in the buffer. flushThinking() releases them at end-of-stream.
    const s = makeThinkingState();
    const out = feedThinking(s, 'hello world');
    expect(out.visible).toBe('hello');
    expect(s.buffer).toBe(' world');
  });

  it('captures a complete <think>...</think> block in one delta', () => {
    const s = makeThinkingState();
    const out = feedThinking(s, 'A<think>reasoning here</think>B');
    // '<think>' is 7 chars; 'B' is 1 char; the rest is consumed. With
    // the short-input emit, 'B' is emitted immediately because we
    // left the think lane.
    expect(out.visible).toBe('AB');
    expect(out.thinking).toBe('reasoning here');
    expect(s.buffer).toBe('');
  });

  it('does not leak <think> into the visible lane when split across deltas', () => {
    const s = makeThinkingState();
    // First delta is just a partial `<think>` — the parser holds
    // it back from visible until it knows whether the boundary
    // actually opens a think block.
    expect(feedThinking(s, '<think>').visible).toBe('');
    // Second delta completes the open; everything inside the think
    // block goes to thinking.
    const b = feedThinking(s, 'deep thoughts</think>');
    expect(b.visible).toBe('');
    expect(b.thinking).toBe('deep thoughts');
  });

  it('does not leak </think> into the thinking lane when split across deltas', () => {
    const s = makeThinkingState();
    // First delta: 15 chars, in-think. Hold back 7 chars.
    feedThinking(s, '<think>chain of');
    // The buffer holds back 'hain of' (last 7 chars) for boundary
    // detection on the next delta. '<think>c' (8 chars) has already
    // been emitted to thinking.
    expect(s.buffer).toBe('hain of');
    // Second delta completes the think block.
    const out = feedThinking(s, ' thought</think>');
    // The full content 'hain of thought' is captured as thinking;
    // the buffer is cleared on close so the next delta doesn't carry
    // the held-back bytes over.
    expect(out.thinking).toBe('hain of thought');
    expect(out.thinking).not.toMatch(/<\/think>/);
    expect(s.buffer).toBe('');
  });

  it('routes plain text around a think block to visible', () => {
    const s = makeThinkingState();
    const out = feedThinking(s, 'before <think>inside</think>after');
    // 'before ' (7 chars) goes to visible; 'inside' goes to thinking;
    // 'after' (5 chars) goes to visible because the think lane closed.
    expect(out.visible).toBe('before after');
    expect(out.thinking).toBe('inside');
  });

  it('flushThinking emits whatever is left in the buffer', () => {
    const s = makeThinkingState();
    // 10 chars, not in think. The algorithm holds back the last 6
    // chars ('o <wor') for boundary detection; visible is 'hell'.
    feedThinking(s, 'hello <wor');
    const tail = flushThinking(s);
    expect(tail.visible).toBe('o <wor');
    expect(tail.thinking).toBe('');
  });

  it('flushThinking routes leftover to thinking when mid-think', () => {
    const s = makeThinkingState();
    // 22 chars, in-think. Hold back 7. '<think>partial ' (15 chars)
    // already in thinking; 'thought' (7 chars) is in the buffer.
    feedThinking(s, '<think>partial thought');
    expect(s.buffer).toBe('thought');
    const tail = flushThinking(s);
    expect(tail.thinking).toBe('thought');
    expect(tail.visible).toBe('');
  });

  it('flushThinking returns empty when buffer is empty', () => {
    const s = makeThinkingState();
    const tail = flushThinking(s);
    expect(tail.visible).toBe('');
    expect(tail.thinking).toBe('');
  });

  it('strips stray <think>/</think> literals from output (defensive)', () => {
    const s = makeThinkingState();
    // 'foo<think>bar</think>baz' — single delta. visible='foo' +
    // 'baz' (3 < 7 so emit fully) = 'foobaz'; thinking='bar'.
    const out = feedThinking(s, 'foo<think>bar</think>baz');
    expect(out.visible).toBe('foobaz');
    expect(out.thinking).toBe('bar');
    expect(s.buffer).toBe('');
  });

  it('handles a complete stream end-to-end: text + think + text + flush', () => {
    const s = makeThinkingState();
    let allVisible = '';
    let allThinking = '';

    const chunks = [
      'Let me check. ',
      '<think>tide looks calm. ',
      'wind is low.</think>',
      'Safe to go.',
    ];
    for (const chunk of chunks) {
      const out = feedThinking(s, chunk);
      allVisible += out.visible;
      allThinking += out.thinking;
    }
    const tail = flushThinking(s);
    allVisible += tail.visible;
    allThinking += tail.thinking;

    expect(allVisible).toBe('Let me check. Safe to go.');
    expect(allThinking).toBe('tide looks calm. wind is low.');
  });
});
