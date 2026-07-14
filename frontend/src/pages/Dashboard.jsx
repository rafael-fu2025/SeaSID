import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Sparkles, AlertTriangle, Activity, Wind, Droplets, Thermometer } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton, SkeletonKpiStrip, SkeletonForecastGrid, SkeletonChart } from '@/components/Skeleton';
import ForecastTimeline from '@/components/ForecastTimeline';
import { PBadChart } from '@/components/PBadChart';
import { RiskBadge, ProbabilityMeter } from '@/components/RiskBadge';
import { SiteSelector } from '@/components/SiteSelector';
import { ForecastProvenance } from '@/components/ForecastProvenance';
import ActiveLearningNudge from '@/components/ActiveLearningNudge';
import ForecastHorizonSelector from '@/components/ForecastHorizonSelector';
import { cn } from '@/lib/utils';

const level = (p) => (p >= 0.6 ? 'high' : p >= 0.3 ? 'moderate' : 'low');

const aqiLevel = (aqi) => {
  if (aqi == null) return 'low';
  if (aqi >= 150) return 'high';
  if (aqi >= 100) return 'moderate';
  return 'low';
};

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const fmtTimeFull = (iso) =>
  new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

/**
 * Dashboard — primary "live now" panel for the cockpit.
 *
 *  - Picker row at top: site selector + refresh button.
 *  - KPI strip: visibility, current risk, P(no-go), AQI, model in use.
 *  - Selectable 12/24/48-hour timeline grouped into daily rows.
 *  - Probability chart with optimal-window marker.
 *  - Optimal-window summary card with P(no-go) + time + viz.
 *  - Active alert banner.
 *
 * Listens for the global "seasid:refresh" event so the ⌘K palette's
 * Refresh action can re-fetch without prop-drilling.
 */
export default function Dashboard() {
  const [selectedSite, setSelectedSite] = useState('dauin_muck');
  const [forecast, setForecast] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [horizon, setHorizon] = useState(12);
  const cancelRef = useRef(false);

  const load = useCallback(async (siteKey) => {
    cancelRef.current = false;
    setError(null);
    try {
      const [fc, al] = await Promise.all([
        api.getForecast(siteKey, 48),
        api.getAlerts(siteKey),
      ]);
      if (cancelRef.current) return;
      setForecast(fc);
      setAlerts(al.alerts || []);
    } catch (err) {
      if (!cancelRef.current) setError(err.message);
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, []);

  // Initial load + reload on site change
  useEffect(() => {
    setLoading(true);
    load(selectedSite);
    return () => { cancelRef.current = true; };
  }, [selectedSite, load]);

  // ⌘K palette "refresh" event
  useEffect(() => {
    const handler = () => {
      setRefreshing(true);
      load(selectedSite).finally(() => setRefreshing(false));
    };
    window.addEventListener('seasid:refresh', handler);
    return () => window.removeEventListener('seasid:refresh', handler);
  }, [selectedSite, load]);

  const refresh = () => {
    setRefreshing(true);
    load(selectedSite).finally(() => setRefreshing(false));
  };

  const currentHour = forecast?.hours?.[0];
  const visibleHours = forecast?.hours?.slice(0, horizon) || [];
  const optimal = visibleHours.length
    ? visibleHours.reduce((best, hour) => hour.p_bad < best.p_bad ? hour : best)
    : null;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live dive-condition forecast for{' '}
            <span className="font-medium text-foreground">
              {forecast?.site_name ?? '—'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 lg:min-w-[360px]">
          <SiteSelector
            value={selectedSite}
            onChange={setSelectedSite}
            className="flex-1"
            id="dashboard-site"
          />
          <Button
            variant="secondary"
            size="default"
            onClick={refresh}
            disabled={refreshing}
            data-testid="dashboard-refresh"
          >
            {refreshing ? (
              <Skeleton className="size-3.5 rounded-full" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span>Refresh</span>
          </Button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <Card className="border-danger/30 bg-danger/5" data-testid="dashboard-error">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-danger" />
            <div className="text-sm">
              <p className="font-medium text-danger">Could not load forecast</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error}. Start the API with{' '}
                <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px]">
                  python -m scripts.run_api
                </code>{' '}
                in the backend directory.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts banner */}
      {!loading && alerts.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-warning" />
            <div className="text-sm">
              <p className="font-medium text-warning">
                {alerts.length} active alert{alerts.length === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {alerts.slice(0, 3).map((a) => `[${a.kind}] ${a.message}`).join(' · ')}
                {alerts.length > 3 && ` · +${alerts.length - 3} more`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 8: Active-learning nudge — surfaces past dates where the
          model was uncertain (p_bad in [0.35, 0.65]) and an operator
          confirmation would teach the most. */}
      {!loading && selectedSite && (
        <ActiveLearningNudge
          siteKey={selectedSite}
          onVerified={() => load(selectedSite)}
        />
      )}

      {/* Loading skeletons */}
      {loading && !forecast && (
        <div className="flex flex-col gap-6">
          <SkeletonKpiStrip count={5} />
          <SkeletonForecastGrid count={horizon} />
          <SkeletonChart />
        </div>
      )}

      {/* KPI strip */}
      {!loading && currentHour && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Current conditions">
          <KpiCard
            label="Visibility"
            value={currentHour.viz_label ?? '—'}
            sub={`${fmtTime(currentHour.ts)} UTC`}
            Icon={Droplets}
          />
          <KpiCard
            label="Current risk"
            value={<RiskBadge risk={currentHour.current_risk} />}
            sub="Surface current assessment"
            Icon={Activity}
          />
          <KpiCard
            label="P(no-go)"
            value={
              <span className="num font-mono tabular-nums">
                {Math.round(currentHour.p_bad * 100)}%
              </span>
            }
            sub="Threshold 60% / 30%"
            tone={level(currentHour.p_bad)}
            Icon={Sparkles}
          />
          {forecast?.air?.available ? (
            <KpiCard
              label="Air quality"
              value={
                <span className="num font-mono tabular-nums">
                  {Math.round(forecast.air.aqi)}
                </span>
              }
              sub={
                forecast.air.quality === 'local'
                  ? `AQICN · ${forecast.air.station_name || 'local station'}`
                  : `AQICN · ${forecast.air.quality} station`
              }
              tone={aqiLevel(forecast.air.aqi)}
              Icon={Wind}
              dataTestid="kpi-air"
            />
          ) : (
            <KpiCard
              label="Air quality"
              value={<span className="text-muted-foreground">—</span>}
              sub="AQICN not configured"
              Icon={Wind}
              dataTestid="kpi-air"
            />
          )}
          <KpiCard
            label="Model in use"
            value={
              <span className="text-base font-medium text-foreground">
                {forecast?.model_version ?? currentHour.model_used ?? '—'}
              </span>
            }
            sub={forecast?.ml_bundle_loaded ? 'Bundle loaded' : 'Heuristic fallback'}
            Icon={Thermometer}
          />
        </section>
      )}

      {/* Provenance strip (roadmap #8) — answers "how old?", "which source?",
          "which model?" from the same screen as the KPIs. */}
      {!loading && forecast && (
        <ForecastProvenance
          dataAsOf={forecast.data_as_of}
          freshness={forecast.freshness}
          providers={forecast.providers}
          modelVersion={forecast.model_version}
          generatedAt={forecast.generated_at}
          compact
        />
      )}

      {/* Timeline */}
      {!loading && visibleHours.length > 0 && (
        <section aria-labelledby="timeline-heading">
          <header className="mb-3 flex items-end justify-between">
            <div>
              <h2 id="timeline-heading" className="text-base font-semibold tracking-tight">
                {horizon}-hour forecast
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Each hour is a single forecast card with risk badge and probability meter.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <ForecastHorizonSelector value={horizon} onChange={setHorizon} />
              {optimal && (
                <Badge variant="secondary" className="font-mono">
                  <Sparkles className="mr-1 size-3 text-positive" />
                  Optimal at{' '}
                  {new Date(optimal.ts).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                </Badge>
              )}
            </div>
          </header>
          <ForecastTimeline hours={visibleHours} optimalIso={optimal?.ts} />
        </section>
      )}

      {/* Probability chart */}
      {!loading && visibleHours.length > 0 && (
        <PBadChart hours={visibleHours} optimalIso={optimal?.ts} />
      )}

      {/* Optimal window summary */}
      {!loading && optimal && (
        <section>
          <header className="mb-3">
            <h2 className="text-base font-semibold tracking-tight">Optimal dive window</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The hour in the next {horizon} with the lowest no-go probability.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCell label="When" value={fmtTimeFull(optimal.ts)} mono />
            <SummaryCell label="Visibility" value={optimal.viz_label} />
            <SummaryCell
              label="P(no-go)"
              value={`${Math.round(optimal.p_bad * 100)}%`}
              tone={level(optimal.p_bad)}
              mono
            />
          </div>
        </section>
      )}

      {/* Footer */}
      {!loading && forecast && (
        <footer className="pt-2 text-right text-[11px] text-muted-foreground">
          Generated {fmtTimeFull(forecast.generated_at)}
        </footer>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, Icon, tone, dataTestid }) {
  return (
    <Card
      className="gap-2 p-4"
      data-testid={dataTestid}
    >
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3.5" aria-hidden />}
      </div>
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'high' && 'text-danger',
          tone === 'moderate' && 'text-warning',
          tone === 'low' && 'text-positive',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
    </Card>
  );
}

function SummaryCell({ label, value, mono, tone }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-lg',
          mono && 'font-mono tabular-nums',
          tone === 'high' && 'text-danger',
          tone === 'moderate' && 'text-warning',
          tone === 'low' && 'text-positive',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}
