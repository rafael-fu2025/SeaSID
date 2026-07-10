import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from 'lucide-react';

/**
 * PBadChart — 12-hour probability-of-no-go line chart.
 *
 * Pure SVG (no charting library). Renders:
 *  - 0.60 / 0.30 threshold grid (no-go / caution bands)
 *  - Filled area under the curve
 *  - A vertical pin on the optimal hour
 *  - X-axis: HH:MM labels every 3 hours
 *  - Y-axis: 0..1 with implicit band coloring
 *
 * All fills/strokes use Tailwind utility classes mapped to SeaSID
 * design tokens, so dark/light themes swap cleanly without code changes.
 */
const VIEW_W = 720;
const VIEW_H = 220;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 32 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

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
              className="h-44 w-full"
              role="img"
              aria-label="12-hour P(no-go) chart"
            >
              {/* Threshold bands */}
              <rect
                x={MARGIN.left}
                y={MARGIN.top}
                width={PLOT_W}
                height={PLOT_H * 0.4}
                className="fill-danger/10"
                aria-hidden
              />
              <rect
                x={MARGIN.left}
                y={MARGIN.top + PLOT_H * 0.4}
                width={PLOT_W}
                height={PLOT_H * 0.3}
                className="fill-warning/10"
                aria-hidden
              />
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <line
                  key={v}
                  x1={MARGIN.left}
                  x2={VIEW_W - MARGIN.right}
                  y1={MARGIN.top + (1 - v) * PLOT_H}
                  y2={MARGIN.top + (1 - v) * PLOT_H}
                  className="stroke-border"
                  strokeWidth={1}
                  strokeDasharray={v === 0 ? '' : '2 4'}
                  aria-hidden
                />
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
              {/* Area under the curve */}
              <path d={areaPath(data.points)} className="fill-reef/15" />
              {/* Curve */}
              <path d={linePath(data.points)} className="stroke-reef" strokeWidth={2} fill="none" />
              {/* Points */}
              {data.points.map((p) => (
                <circle
                  key={p.x}
                  cx={p.x}
                  cy={p.y}
                  r={p.isOptimal ? 5 : 2.5}
                  className={
                    p.isOptimal
                      ? 'fill-reef stroke-foreground'
                      : 'fill-reef/80 stroke-transparent'
                  }
                  strokeWidth={p.isOptimal ? 2 : 0}
                />
              ))}
              {/* Optimal marker */}
              {data.optimalPoint && (
                <g>
                  <line
                    x1={data.optimalPoint.x}
                    x2={data.optimalPoint.x}
                    y1={MARGIN.top}
                    y2={VIEW_H - MARGIN.bottom}
                    className="stroke-reef"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={data.optimalPoint.x}
                    y={MARGIN.top + 6}
                    textAnchor="middle"
                    className="fill-reef text-[10px] font-semibold uppercase tracking-wider"
                  >
                    optimal
                  </text>
                </g>
              )}
              {/* X-axis labels */}
              {data.xLabels.map((l) => (
                <text
                  key={l.x}
                  x={l.x}
                  y={VIEW_H - MARGIN.bottom + 16}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {l.label}
                </text>
              ))}
            </svg>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Red band ≥ 60% (no-go) · amber 30–60% (caution). Generated{' '}
              {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function buildSeries(hours, optimalIso) {
  if (!Array.isArray(hours) || hours.length === 0) {
    return { points: [], xLabels: [], optimalPoint: null, generatedAt: null };
  }
  const n = hours.length;
  const points = hours.map((h, i) => {
    const x = MARGIN.left + (i / Math.max(n - 1, 1)) * PLOT_W;
    const y = MARGIN.top + (1 - (h.p_bad ?? 0)) * PLOT_H;
    return { x, y, isOptimal: optimalIso && h.ts === optimalIso, h };
  });
  const xLabels = hours
    .filter((_, i) => i % 3 === 0 || i === hours.length - 1)
    .map((h, idx) => {
      const i = hours.indexOf(h);
      return {
        x: MARGIN.left + (i / Math.max(n - 1, 1)) * PLOT_W,
        label: fmtTime(h.ts),
      };
    });
  return {
    points,
    xLabels,
    optimalPoint: points.find((p) => p.isOptimal) || null,
    generatedAt: hours[0]?.generated_at,
  };
}

function linePath(points) {
  return points.reduce((acc, p, i) => {
    const cmd = i === 0 ? 'M' : 'L';
    return `${acc} ${cmd} ${p.x} ${p.y}`;
  }, '').trim();
}

function areaPath(points) {
  const line = linePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${VIEW_H - MARGIN.bottom} L ${first.x} ${VIEW_H - MARGIN.bottom} Z`;
}

export default PBadChart;
export { PBadChart };
