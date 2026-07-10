import { useState, useRef } from 'react';
import { StarIcon, InfoIcon } from './icons';

/**
 * PBadChart — line chart for P(no-go) over a forecast window.
 *
 * Implementation:
 *  - pure SVG (no third-party chart lib)
 *  - gradient stroke for subtle visual weight
 *  - interactive overlay: hovering shows a tooltip with timestamp + value
 *  - optimal hour drawn as a starred marker
 *
 * Props:
 *   hours:        array of { ts: ISO8601, p_bad: 0..1 }
 *   optimalIso?:  ISO8601 string for the optimal-window hour
 *   width?:       svg viewBox width (default 960)
 *   height?:      svg viewBox height (default 280)
 */
export default function PBadChart({
  hours = [],
  optimalIso = null,
  width = 960,
  height = 280,
}) {
  const PAD = { l: 48, r: 24, t: 24, b: 36 };
  const innerW = width - PAD.l - PAD.r;
  const innerH = height - PAD.t - PAD.b;
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  if (!hours.length) {
    return (
      <div className="chart-frame__body empty">
        <div className="empty__title">No forecast data</div>
        <div>Pull a fresh forecast from the dashboard to populate the chart.</div>
      </div>
    );
  }

  const n = hours.length;
  const xAt = (i) => PAD.l + (i * innerW) / Math.max(1, n - 1);
  const yAt = (v) => {
    const c = Math.max(0, Math.min(1, v));
    return PAD.t + innerH - c * innerH;
  };

  const points = hours.map((h, i) => ({
    x: xAt(i),
    y: yAt(h.p_bad ?? 0),
    raw: h,
    i,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    linePath +
    ` L${points.at(-1).x.toFixed(1)},${(PAD.t + innerH).toFixed(1)}` +
    ` L${points[0].x.toFixed(1)},${(PAD.t + innerH).toFixed(1)} Z`;

  const optIdx = optimalIso ? hours.findIndex((h) => h.ts === optimalIso) : -1;

  // Y ticks: 0, 25, 50, 75, 100
  const yticks = [0, 0.25, 0.5, 0.75, 1.0];

  // X ticks: show 4 evenly-spaced labels
  const xTicks = (() => {
    if (n <= 1) return [0];
    const positions = [0, Math.round(n * 0.33), Math.round(n * 0.66), n - 1];
    return Array.from(new Set(positions));
  })();

  const fmtHour = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  const handleMove = (evt) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = width / rect.width;
    const xLocal = (evt.clientX - rect.left) * ratio;
    // Find nearest point by x distance
    let best = points[0];
    let bestDist = Infinity;
    for (const p of points) {
      const d = Math.abs(p.x - xLocal);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    setHover({ ...best, px: best.x / ratio, py: best.y / ratio });
  };

  return (
    <div className="chart-frame" data-testid="pbad-chart">
      <div className="chart-frame__head">
        <div>
          <div className="chart-frame__title">Probability of a no-go day</div>
          <div className="chart-frame__sub muted">Hourly, next {n} hours · lower is safer</div>
        </div>
        <div className="chart-frame__legend">
          <div className="chart-frame__legend-item">
            <span className="chart-frame__legend-dot" /> P(no-go)
          </div>
          <div className="chart-frame__legend-item">
            <span className="chart-frame__legend-dot chart-frame__legend-dot--optimal" /> Optimal window
          </div>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          className="pbad-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="pbad-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="pbad-stroke" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent-hover)" />
            </linearGradient>
            <clipPath id="pbad-clip">
              <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} />
            </clipPath>
          </defs>

          {/* y gridlines */}
          {yticks.map((t) => {
            const y = PAD.t + innerH - t * innerH;
            return (
              <g key={t}>
                <line
                  x1={PAD.l}
                  y1={y}
                  x2={PAD.l + innerW}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeDasharray={t === 0 ? '0' : '2 4'}
                />
                <text
                  x={PAD.l - 10}
                  y={y + 4}
                  fontSize="10"
                  fill="var(--text-tertiary)"
                  textAnchor="end"
                  fontFamily="var(--font-mono)"
                >
                  {(t * 100).toFixed(0)}%
                </text>
              </g>
            );
          })}

          {/* area + line */}
          <g clipPath="url(#pbad-clip)">
            <path d={areaPath} fill="url(#pbad-fill)" />
            <path
              d={linePath}
              fill="none"
              stroke="url(#pbad-stroke)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* baseline axis */}
          <line
            x1={PAD.l}
            y1={PAD.t + innerH}
            x2={PAD.l + innerW}
            y2={PAD.t + innerH}
            stroke="var(--border-default)"
          />
          <line
            x1={PAD.l}
            y1={PAD.t}
            x2={PAD.l}
            y2={PAD.t + innerH}
            stroke="var(--border-default)"
          />

          {/* points */}
          {points.map((p, i) => {
            const isOpt = i === optIdx;
            return (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isOpt ? 5 : 3.5}
                  fill={isOpt ? 'var(--positive)' : 'var(--surface-0)'}
                  stroke={isOpt ? 'var(--positive)' : 'var(--accent)'}
                  strokeWidth="2"
                />
                {isOpt && (
                  <text
                    x={p.x}
                    y={p.y - 12}
                    fontSize="11"
                    fill="var(--positive)"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    optimal · {fmtHour(p.raw.ts)}
                  </text>
                )}
              </g>
            );
          })}

          {/* x-axis labels */}
          {xTicks.map((i) => {
            const h = hours[i];
            const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
            return (
              <text
                key={i}
                x={xAt(i)}
                y={height - 12}
                fontSize="10"
                fill="var(--text-tertiary)"
                textAnchor={anchor}
                fontFamily="var(--font-mono)"
              >
                {fmtHour(h.ts)}
              </text>
            );
          })}

          {/* hover crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={hover.x}
                y1={PAD.t}
                x2={hover.x}
                y2={PAD.t + innerH}
                stroke="var(--border-strong)"
                strokeDasharray="3 3"
              />
            </g>
          )}
        </svg>

        {hover && (
          <div
            className="pbad-tooltip"
            style={{
              left: hover.px,
              top: hover.py,
              transform: 'translate(-50%, calc(-100% - 12px))',
            }}
          >
            <div className="pbad-tooltip__row">
              <span>Time</span>
              <span className="pbad-tooltip__time">{fmtHour(hover.raw.ts)}</span>
            </div>
            <div className="pbad-tooltip__row">
              <span>P(no-go)</span>
              <span className="mono">{Math.round((hover.raw.p_bad ?? 0) * 100)}%</span>
            </div>
            <div className="pbad-tooltip__row">
              <span>Risk</span>
              <span>{hover.raw.risk || '—'}</span>
            </div>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-3)' }}>
        <InfoIcon size={12} /> Computed from rolling 24/48h weather + tide features; LSTM model
        when loaded, otherwise rule-based proxy.
      </p>
    </div>
  );
}

// Re-exports kept for tests / older imports.
export { StarIcon };
