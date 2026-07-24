import { useMemo, useSyncExternalStore } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Sparkles } from 'lucide-react';

/**
 * PBadChart - 12-hour probability-of-no-go visualization.
 *
 * Built on Recharts (LineChart + Line + ReferenceLine) and mirrors the design
 * from the reference forecasting project:
 *  - A smooth monochromatic teal line traces the per-hour P(no-go).
 *  - One coloured circle per hour: green = Go (< 30%), amber = Caution
 *    (30 - 60%), red = No-Go (>= 60%). The optimal hour is rendered as a
 *    larger ring filled with the reef accent colour.
 *  - Two dashed ReferenceLines anchor the 30% and 60% thresholds.
 *  - Dashed CartesianGrid and small tick labels keep the chart calm.
 *  - A clean card tooltip surfaces full date / risk / percentage on hover.
 *  - Colours track the active CSS theme via :root custom properties so the
 *    dark / light theme toggle stays reactive.
 *
 * Test contract:
 *  - data-testid="pbad-chart" wraps the Card.
 *  - data-testid="pbad-chart-frame" wraps the chart (a div).
 *  - One <circle> per hour, drawn by the Line dot callback.
 *  - The optimal hour's circle is larger (r=5) than the rest (r=3.5).
 *  - Empty-state row appears when no hours are passed.
 *  - "best window" footer summarises the optimum when present.
 *  - Two dashed threshold lines exist (markers: pbad-guide-warn/no-go).
 */

const WARN_THRESHOLD = 0.3;
const NO_GO_THRESHOLD = 0.6;
const OPTIMAL_R = 5;
const NORMAL_R = 3.5;

const HEX_FALLBACKS = {
  positive: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  reef: '#06b6d4',
  reefBright: '#22d3ee',
  border: '#334155',
  borderSoft: '#1f2937',
  muted: '#94a3b8',
  card: '#0f1a2c',
  cardFg: '#e2e8f0',
  surface: '#0b1422',
  white: '#ffffff',
};

// --- reactive theme colour hook ---------------------------------------
function subscribe() {
  return () => {};
}
function getSnapshot() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
function getServerSnapshot() {
  return 'ssr';
}

function useThemeColors() {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const read = (name, fallback) => {
      if (typeof document === 'undefined') return HEX_FALLBACKS[fallback];
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v || HEX_FALLBACKS[fallback];
    };
    return {
      positive: read('--color-positive', 'positive'),
      warning: read('--color-warning', 'warning'),
      danger: read('--color-danger', 'danger'),
      reef: read('--color-reef', 'reef'),
      border: read('--border', 'border'),
      muted: read('--muted-foreground', 'muted'),
      card: read('--card', 'card'),
      cardFg: read('--card-foreground', 'cardFg'),
      surface: read('--background', 'surface'),
      white: HEX_FALLBACKS.white,
    };
  }, []);
}

// --- helpers ----------------------------------------------------------

function riskLevel(p) {
  if (p == null) return 'Unknown';
  if (p >= NO_GO_THRESHOLD) return 'No-Go';
  if (p >= WARN_THRESHOLD) return 'Caution';
  return 'Go';
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fmtFull(iso) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fmtPct(p) {
  return p == null ? '-' : `${Math.round(p * 100)}%`;
}
function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function dotColor(level, colors) {
  switch (level) {
    case 'No-Go':
      return colors.danger;
    case 'Caution':
      return colors.warning;
    case 'Go':
      return colors.positive;
    default:
      return colors.muted;
  }
}

// --- tooltip / dot shapes ----------------------------------------------

function CustomTooltip({ active, payload, colors }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const fill = dotColor(point.level, colors);
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{
        background: colors.card,
        borderColor: colors.border,
        color: colors.cardFg,
      }}
    >
      <div className="font-medium">{point.fullLabel}</div>
      <div className="mt-1 flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-2 rounded-sm"
          style={{ background: fill }}
        />
        <span className="font-semibold">{point.level}</span>
        <span style={{ color: colors.muted }}>� {fmtPct(point.p_bad)} no-go</span>
      </div>
    </div>
  );
}

function HourDot(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const colors = props.colors || {};
  const isOptimal = Boolean(payload?.isOptimal);
  if (isOptimal) {
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={OPTIMAL_R}
          fill={colors.reef}
          stroke={colors.card}
          strokeWidth={2}
        />
        <circle
          cx={cx}
          cy={cy}
          r={2.5}
          fill={colors.card}
          stroke={colors.reef}
          strokeWidth={1}
        />
      </g>
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={NORMAL_R}
      fill={dotColor(payload?.level, colors)}
      stroke={colors.card}
      strokeWidth={1.5}
    />
  );
}

// --- main component ----------------------------------------------------

function PBadChart({
  hours = [],
  optimalIso,
  label = 'Probability of no-go - 12 hours',
}) {
  const colors = useThemeColors();

  const series = useMemo(() => {
    if (!Array.isArray(hours) || hours.length === 0) {
      return {
        data: [],
        optimalIndex: -1,
        labelStep: 1,
        isEmpty: true,
      };
    }
    const n = hours.length;
    const optimalIndex = optimalIso
      ? hours.findIndex((h) => h.ts === optimalIso)
      : -1;
    const labelStep = Math.max(1, Math.ceil(n / 12));
    const data = hours.map((h, i) => ({
      i,
      ts: h.ts,
      p_bad: h.p_bad ?? 0,
      level: riskLevel(h.p_bad ?? 0),
      label: fmtTime(h.ts),
      fullLabel: fmtFull(h.ts),
      isOptimal: i === optimalIndex,
    }));
    return { data, optimalIndex, labelStep, isEmpty: false };
  }, [hours, optimalIso]);

  const optimalPoint =
    series.optimalIndex >= 0 ? series.data[series.optimalIndex] : null;

  return (
    <Card className="rounded-md" data-testid="pbad-chart">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4 text-reef" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {series.isEmpty ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No forecast data.
          </p>
        ) : (
          <>
            <div
              className="relative h-56 w-full"
              data-testid="pbad-chart-frame"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={series.data}
                  margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid
                    stroke={colors.border}
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                    vertical={false}
                  />
                  <ReferenceLine
                    y={WARN_THRESHOLD}
                    stroke={colors.positive}
                    strokeDasharray="4 4"
                    strokeOpacity={0.55}
                    strokeWidth={1}
                    data-testid="pbad-guide-warn"
                  />
                  <ReferenceLine
                    y={NO_GO_THRESHOLD}
                    stroke={colors.danger}
                    strokeDasharray="4 4"
                    strokeOpacity={0.55}
                    strokeWidth={1}
                    data-testid="pbad-guide-no-go"
                  />
                  <XAxis
                    dataKey="label"
                    interval={series.labelStep - 1}
                    tick={{ fontSize: 10, fill: colors.muted }}
                    tickLine={false}
                    axisLine={{ stroke: colors.border, strokeOpacity: 0.6 }}
                    minTickGap={6}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                    ticks={[0, 0.25, 0.5, 0.75, 1]}
                    tick={{ fontSize: 10, fill: colors.muted }}
                    tickLine={false}
                    axisLine={{ stroke: colors.border, strokeOpacity: 0.6 }}
                    width={44}
                  />
                  <Tooltip
                    cursor={{
                      stroke: colors.reef,
                      strokeOpacity: 0.5,
                      strokeDasharray: '3 3',
                    }}
                    content={<CustomTooltip colors={colors} />}
                  />
                  <Line
                    type="monotone"
                    dataKey="p_bad"
                    stroke={colors.reef}
                    strokeWidth={2}
                    dot={(p) => <HourDot {...p} colors={colors} />}
                    activeDot={{
                      r: 6,
                      fill: colors.reef,
                      stroke: colors.card,
                      strokeWidth: 2,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block size-2 rounded-sm"
                  style={{ background: colors.positive }}
                  aria-hidden
                />
                &lt; 30% (Go)
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block size-2 rounded-sm"
                  style={{ background: colors.warning }}
                  aria-hidden
                />
                30-60% (Caution)
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block size-2 rounded-sm"
                  style={{ background: colors.danger }}
                  aria-hidden
                />
                &gt;= 60% (No-Go)
              </span>
              <span className="ml-auto inline-flex items-center gap-1">
                {optimalPoint ? (
                  <>
                    <Sparkles
                      className="size-3"
                      style={{ color: colors.reef }}
                      aria-hidden
                    />
                    Best window {fmtClock(optimalPoint.ts)}
                    {optimalPoint.p_bad != null
                      ? ` � ${fmtPct(optimalPoint.p_bad)}`
                      : ''}
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

export default PBadChart;
export { PBadChart };

