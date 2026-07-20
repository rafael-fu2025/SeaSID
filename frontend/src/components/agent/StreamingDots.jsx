import waveGif from '@/assets/wave.gif';

/**
 * StreamingDots — "Agent thinking" loading indicator.
 *
 * Originally a 3-dot pulsing row, now backed by the wave.gif shipped in
 * ``@/assets``. Keeping the component name + testid (``streaming-dots``)
 * so callers and existing tests are not churned. The aria-live region is
 * still announced as "Agent thinking" (override via the ``label`` prop).
 */
export function StreamingDots({ className, label = 'Agent thinking' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="streaming-dots"
      className={`inline-flex items-center ${className ?? ''}`}
    >
      <img
        src={waveGif}
        alt=""
        aria-hidden="true"
        data-testid="streaming-dots-gif"
        className="h-5 w-auto select-none"
        draggable={false}
      />
    </div>
  );
}
