/**
 * StreamingDots — 3-dot typing indicator with staggered pulse.
 *
 * Ports the visual feel of minimax_cb's `.thinking-dot` (a 6×6
 * pulsing circle) but expands to the standard three-dot pattern that
 * users recognise from every modern chat app (Slack, iMessage, etc.).
 *
 * The pulse is staggered so the dots feel like a wave rather than
 * three independent dots flashing in unison.
 */
export function StreamingDots({ className, label = 'Agent thinking' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="streaming-dots"
      className={`inline-flex items-center gap-1 ${className ?? ''}`}
    >
      <span
        className="block size-1.5 rounded-full bg-reef/70 animate-pulse"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="block size-1.5 rounded-full bg-reef/70 animate-pulse"
        style={{ animationDelay: '180ms' }}
      />
      <span
        className="block size-1.5 rounded-full bg-reef/70 animate-pulse"
        style={{ animationDelay: '360ms' }}
      />
    </div>
  );
}
