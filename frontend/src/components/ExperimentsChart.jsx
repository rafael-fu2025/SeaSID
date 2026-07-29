import { useMemo, useSyncExternalStore } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

/**
 * ExperimentsChart — grouped bar chart of the model-comparison metrics.
 *
 * Companion to the Experiments results table: it receives the same
 * normalized rows (see `toMetricRows` in pages/Experiments.jsx), so any
 * payload shape the table understands (`model_comparison`, `by_model`,
 * `models` array, bare array) renders here too, and live SSE `metric`
 * updates during a run flow straight through — each model's bars appear
 * as soon as its metrics land in state.
 *
 * Layout mirrors the backend's matplotlib figure
 * (`_plot_model_comparison` in backend/app/lib/experiments.py):
 * metrics on the X axis, one bar per model per metric, Y fixed to [0, 1].
 *
 * Test contract:
 *  - data-testid="experiments-chart" wraps the Card.
 *  - data-testid="experiments-chart-frame" wraps the Recharts container.
 *  - data-testid="experiments-chart-legend-<model>" — one HTML legend
 *    entry per model (asserted in tests since jsdom gives the
 *    ResponsiveContainer zero size and renders no SVG bars).
 *  - The best model's legend entry contains a "best" marker.
 */

const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'auc_roc'];

const fmt = (v) => (v == null ? '—' : Number(v).toFixed(3));

const HEX_FALLBACKS = {
  border: '#334155',
  muted: '#94a3b8',
  card: '#0f1a2c',
  cardFg: '#e2e8f0',
};

// Fixed per-series palette, assigned by row order so colours stay stable
// while a live run fills the comparison in model-by-model.
const SERIES_PALETTE = ['#06b6d4', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#94a3b8'];

// --- reactive theme colour hook (same pattern as PBadChart) -------------
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
      border: read('--border', 'border'),
      muted: read('--muted-foreground', 'muted'),
      card: read('--card', 'card'),
      cardFg: read('--card-foreground', 'cardFg'),
    };
  }, []);
}

function CustomTooltip({ active, payload, label, colors }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{
        background: colors.card,
        borderColor: colors.border,
        color: colors.cardFg,
      }}
    >
      <div className="font-mono font-medium uppercase tracking-wider">{label}</div>
      <div className="mt-1 flex flex-col gap-0.5">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2 rounded-sm"
              style={{ background: entry.color }}
            />
            <span className="font-mono">{entry.dataKey}</span>
            <span className="ml-auto font-mono tabular-nums" style={{ color: colors.muted }}>
              {fmt(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentsChart({ rows = [], bestModel = null }) {
  const colors = useThemeColors();

  // Pivot the per-model rows into per-metric points so each metric is an
  // X-axis group holding one bar per model: { metric, rule: 0.78, xgb: … }.
  const { data, series } = useMemo(() => {
    const names = rows.map((r) => r.name).filter(Boolean);
    const points = METRICS.map((metric) => {
      const point = { metric };
      rows.forEach((r) => {
        const v = r[metric];
        point[r.name] = v == null ? null : Number(v);
      });
      return point;
    });
    return { data: points, series: names };
  }, [rows]);

  if (series.length === 0) return null;

  return (
    <Card data-testid="experiments-chart">
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-reef" />
          <CardTitle className="text-base">Metric comparison chart</CardTitle>
        </div>
        <CardDescription>
          The same held-out metrics as the table above, one bar per model per metric.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative h-64 w-full" data-testid="experiments-chart-frame">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid
                stroke={colors.border}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="metric"
                tick={{ fontSize: 10, fill: colors.muted }}
                tickLine={false}
                axisLine={{ stroke: colors.border, strokeOpacity: 0.6 }}
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                tickFormatter={(v) => v.toFixed(2)}
                tick={{ fontSize: 10, fill: colors.muted }}
                tickLine={false}
                axisLine={{ stroke: colors.border, strokeOpacity: 0.6 }}
                width={44}
              />
              <Tooltip
                cursor={{ fill: colors.border, fillOpacity: 0.15 }}
                content={<CustomTooltip colors={colors} />}
              />
              {series.map((name, i) => (
                <Bar
                  key={name}
                  dataKey={name}
                  fill={SERIES_PALETTE[i % SERIES_PALETTE.length]}
                  fillOpacity={bestModel && name !== bestModel ? 0.65 : 1}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {series.map((name, i) => (
            <span
              key={name}
              className="inline-flex items-center gap-1"
              data-testid={`experiments-chart-legend-${name}`}
            >
              <span
                aria-hidden
                className="inline-block size-2 rounded-sm"
                style={{ background: SERIES_PALETTE[i % SERIES_PALETTE.length] }}
              />
              <span className="font-mono">{name}</span>
              {bestModel === name && (
                <span className="text-[10px] uppercase tracking-wider text-reef">best</span>
              )}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default ExperimentsChart;
export { ExperimentsChart };
