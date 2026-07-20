import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Sparkles } from 'lucide-react';

/**
 * PBadChart — 12-hour probability-of-no-go visualization.
 *
 * Pure SVG. Each forecast hour is a column whose height is proportional to
 * its P(no-go) and whose colour encodes the risk band (green / amber / red).
 *  - Solid background bands mark the threshold regions (0–30, 30–60, 60–100).
 *  - Dashed guides drop in at the 30% and 60% thresholds so the bands are
 *    quantitatively anchored.
 *  - The optimal hour carries a larger ring + "Optimal" badge above the bar
 *    so it remains the visual anchor in a flat-low forecast.
 *  - All shapes inherit Tailwind design tokens; theme is dark / light safe.
 *
 * Test contract:
 *  - The card exposes data-testid="pbad-chart".
 *  - The chart SVG is data-testid="pbad-chart-svg".
 *  - One <circle> per forecast hour (HOURS.length circles).
 *  - The optimal hour's circle has r="5" (largest visible radius).
 *  - Empty-state row appears when no hours are passed.
 */

const VIEW_W = 720;
const VIEW_H = 240;
const MARGIN = { top: 32, right: 16, bottom: 36, left: 38 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

const COL_GAP = 6;
const WARN_THRESHOLD = 0.3;
const NO_GO_THRESHOLD = 0.6;

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

const fmtPct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);

function riskLevel(p) {
  if (p == null) return 'unknown';
  if (p >= NO_GO_THRESHOLD) return 'high';
  if (p >= WARN_THRESHOLD) return 'moderate';
  return 'low';
}

const BAR_FILL = {
  low: 'fill-positive',
  moderate: 'fill-warning',
  high: 'fill-danger',
  unknown: 'fill-muted-foreground',
};

const BAR_LABEL = {
  low: 'text-positive',
  moderate: 'text-warning',
  high: 'text-danger',
  unknown: 'text-muted-foreground',
};

const BAND_FILL = {
  high: 'fill-danger/15',
  moderate: 'fill-warning/15',
  low: 'fill-positive/10',
};

function PBadChart({ hours = [], optimalIso }) {
  const data = useMemo(() => buildSeries(hours, optimalIso), [hours, optimalIso]);

  return (
    <Card className="rounded-md" data-testid="pbad-chart">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4 text-reef" />
          Probability of no-go · 12 hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.points.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No forecast data.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              data-testid="pbad-chart-svg"
              className="h-48 w-full"
              role="img"
              aria-label="12-hour P(no-go) chart"
            >
              {/* Risk-band backgrounds */}
              <rect
                x={MARGIN.left}
                y={MARGIN.top}
                width={PLOT_W}
                height={PLOT_H * 0.4}
                className={BAND_FILL.high}
                aria-hidden
              />
              <rect
                x={MARGIN.left}
                y={MARGIN.top + PLOT_H * 0.4}
                width={PLOT_W}
                height={PLOT_H * 0.3}
                className={BAND_FILL.moderate}
                aria-hidden
              />
              <rect
                x={MARGIN.left}
                y={MARGIN.top + PLOT_H * 0.7}
                width={PLOT_W}
                height={PLOT_H * 0.3}
                className={BAND_FILL.low}
                aria-hidden
              />

              {/* Grid lines (subtle) */}
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <line
                  key={v}
                  x1={MARGIN.left}
                  x2={VIEW_W - MARGIN.right}
                  y1={MARGIN.top + (1 - v) * PLOT_H}
                  y2={MARGIN.top + (1 - v) * PLOT_H}
                  className="stroke-border/60"
                  strokeWidth={1}
                  strokeDasharray={v === 0 ? '' : '2 4'}
                  aria-hidden
                />
              ))}

              {/* Threshold guides + labels */}
              {[NO_GO_THRESHOLD, WARN_THRESHOLD].map((v) => (
                <g key={`thr-${v}`}>
                  <line
                    x1={MARGIN.left}
                    x2={VIEW_W - MARGIN.right}
                    y1={MARGIN.top + (1 - v) * PLOT_H}
                    y2={MARGIN.top + (1 - v) * PLOT_H}
                    className={v === NO_GO_THRESHOLD ? 'stroke-danger/70' : 'stroke-warning/70'}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    aria-hidden
                  />
                  <text
                    x={VIEW_W - MARGIN.right - 4}
                    y={MARGIN.top + (1 - v) * PLOT_H - 4}
                    textAnchor="end"
                    className={
                      v === NO_GO_THRESHOLD
                        ? 'fill-danger font-mono text-[9px] uppercase tracking-wider'
                        : 'fill-warning font-mono text-[9px] uppercase tracking-wider'
                    }
                  >
                    {Math.round(v * 100)}%
                  </text>
                </g>
              ))}

              {/* Y-axis labels */}
              {[0, 0.5, 1].map((v) => (
                <text
                  key={v}
                  x={MARGIN.left - 6}
                  y={MARGIN.top + (1 - v) * PLOT_H + 3}
                  textAnchor="end"
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {Math.round(v * 100)}%
                </text>
              ))}

              {/* Column bars */}
              {data.bars.map((bar) => (
                <g key={`bar-${bar.i}`}>
                  <rect
                    x={bar.x}
                    y={bar.barY}
                    width={bar.w}
                    height={bar.barH}
                    rx={3}
                    ry={3}
                    className={`${BAR_FILL[bar.level]} ${bar.p == null ? 'opacity-40' : ''}`}
                  />
                  {bar.p != null && bar.barH > 18 && (
                    <text
                      x={bar.x + bar.w / 2}
                      y={bar.barY + 12}
                      textAnchor="middle"
                      className={`fill-background font-mono text-[9px] font-semibold tabular-nums`}
                    >
                      {fmtPct(bar.p)}
                    </text>
                  )}
                </g>
              ))}

              {/* Optimal-hour badge */}
              {data.optimalPoint && (
                <g>
                  <rect
                    x={data.optimalPoint.x - 44}
                    y={MARGIN.top - 22}
                    width={88}
                    height={18}
                    rx={9}
                    ry={9}
                    className="fill-reef stroke-reef"
                  />
                  <text
                    x={data.optimalPoint.x}
                    y={MARGIN.top - 9}
                    textAnchor="middle"
                    className="fill-reef-foreground text-[10px] font-semibold uppercase tracking-wider"
                  >
                    Optimal
                  </text>
                </g>
              )}

              {/* Top-of-bar markers (one per hour) */}
              {data.points.map((p) => (
                <circle
                  key={p.i}
                  cx={p.x}
                  cy={p.y}
                  r={p.isOptimal ? 5 : 3}
                  className={
                    p.isOptimal
                      ? 'fill-reef stroke-foreground'
                      : `fill-background stroke-2 ${BAR_LABEL[p.level]}`
                  }
                  stroke={p.isOptimal ? undefined : 'currentColor'}
                  strokeWidth={p.isOptimal ? 2 : 1.5}
                />
              ))}

              {/* X-axis: time labels under every other hour so 12 ticks fit */}
              {data.xLabels.map((l) => (
                <text
                  key={`xl-${l.i}`}
                  x={l.x}
                  y={VIEW_H - MARGIN.bottom + 18}
                  textAnchor="middle"
                  className={
                    l.isOptimal
                      ? 'fill-reef font-mono text-[10px] font-semibold'
                      : 'fill-muted-foreground font-mono text-[10px]'
                  }
                >
                  {l.label}
                </text>
              ))}
            </svg>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm bg-positive" aria-hidden />
                &lt; 30% (go)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm bg-warning" aria-hidden />
                30–60% (caution)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm bg-danger" aria-hidden />
                ≥ 60% (no-go)
              </span>
              <span className="ml-auto inline-flex items-center gap-1">
                {data.optimalPoint ? (
                  <>
                    <Sparkles className="size-3 text-reef" aria-hidden />
                    Best window {fmtTime(data.optimalPoint.ts)}{data.optimalPoint.p != null ? ` · ${fmtPct(data.optimalPoint.p)}` : ''}
                  </>
                ) : (
                  <span>No clear best window yet</span>
                )}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function buildSeries(hours, optimalIso) {
  if (!Array.isArray(hours) || hours.length === 0) {
    return { points: [], bars: [], xLabels: [], optimalPoint: null, generatedAt: null };
  }
  const n = hours.length;
  const slotW = PLOT_W / n;
  const barW = Math.max(slotW - COL_GAP, 4);
  const baselineY = MARGIN.top + PLOT_H;

  const points = hours.map((h, i) => {
    const cx = MARGIN.left + slotW * (i + 0.5);
    const p = h.p_bad ?? 0;
    const level = riskLevel(p);
    return {
      i,
      x: cx,
      ts: h.ts,
      p,
      level,
      y: baselineY - p * PLOT_H,
      isOptimal: Boolean(optimalIso) && h.ts === optimalIso,
    };
  });

  const bars = points.map((p) => {
    const x = p.x - barW / 2;
    const h = Math.max(p.p * PLOT_H, 2);
    return {
      i: p.i,
      x,
      w: barW,
      barY: baselineY - h,
      barH: h,
      p: p.p,
      level: p.level,
    };
  });

  const xLabels = hours
    .filter((_, i) => i % 2 === 0 || i === hours.length - 1 || hours[i].ts === optimalIso)
    .map((h) => {
      const i = hours.indexOf(h);
      return {
        i,
        x: MARGIN.left + slotW * (i + 0.5),
        label: fmtTime(h.ts),
        isOptimal: Boolean(optimalIso) && h.ts === optimalIso,
      };
    });

  const optimalPoint = points.find((p) => p.isOptimal) || null;
  return {
    points,
    bars,
    xLabels,
    optimalPoint,
    generatedAt: hours[0]?.generated_at,
  };
}

export default PBadChart;
export { PBadChart };
