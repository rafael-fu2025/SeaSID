import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertTriangle, Sparkles, Activity } from 'lucide-react';
import { api } from '@/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton, SkeletonChart } from '@/components/Skeleton';
import { PBadChart } from '@/components/PBadChart';
import { RiskBadge } from '@/components/RiskBadge';
import { SiteSelector } from '@/components/SiteSelector';
import MarkdownResponse from '@/components/MarkdownResponse';

const METRIC_DEFS = [
  { key: 'precip_24h_mm',    label: 'Precip · 24h',  unit: 'mm' },
  { key: 'precip_recent_3h', label: 'Precip · 3h',   unit: 'mm' },
  { key: 'wind_max_kmh',     label: 'Wind max',      unit: 'km/h' },
  { key: 'wave_max_m',       label: 'Wave max',      unit: 'm' },
  { key: 'sea_temp_c',       label: 'Sea temp',      unit: '°C' },
  { key: 'tide_range_m',     label: 'Tide range',    unit: 'm' },
];

const fmt = (v, unit) => {
  if (v == null) return '—';
  const decimals = unit === 'm' || unit === '°C' ? 1 : 0;
  return `${Number(v).toFixed(decimals)}${unit ? ' ' + unit : ''}`;
};

/**
 * Forecast — AI briefing + live feature snapshot for the next 48h.
 *
 *  - Site selector + refresh button in the header.
 *  - Two-column layout: briefing (MarkdownResponse) on the left,
 *    live feature snapshot + overall risk on the right.
 *  - Bottom strip: P(no-go) chart over the next 12 hours (so the
 *    optimal-window marker from the briefing aligns visually with
 *    the Dashboard's chart).
 *  - Listens for the global "seasid:refresh" event.
 */
export default function Forecast() {
  const [selectedSite, setSelectedSite] = useState('dauin_muck');
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);

  const load = useCallback(async (siteKey) => {
    cancelRef.current = false;
    setError(null);
    try {
      const b = await api.getBriefing(siteKey);
      if (!cancelRef.current) setBriefing(b);
    } catch (err) {
      if (!cancelRef.current) setError(err.message);
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(selectedSite);
    return () => { cancelRef.current = true; };
  }, [selectedSite, load]);

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

  const fc = briefing?.tool_calls?.find((t) => t.name === 'get_forecast');
  const wt = briefing?.tool_calls?.find((t) => t.name === 'get_weather');
  const parsed = parseForecast(fc);
  const optimal = parsed.optimal_window;
  const next12 = (parsed.hours || []).slice(0, 12);

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Forecast
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI briefing and feature snapshot for the next 48 hours.
          </p>
        </div>
        <div className="flex items-center gap-2 lg:min-w-[360px]">
          <SiteSelector
            value={selectedSite}
            onChange={setSelectedSite}
            className="flex-1"
            id="forecast-site"
          />
          <Button
            variant="secondary"
            onClick={refresh}
            disabled={refreshing}
            data-testid="forecast-refresh"
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

      {/* Error */}
      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-danger" />
            <div className="text-sm">
              <p className="font-medium text-danger">Briefing unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && !briefing ? (
        <div className="flex flex-col gap-6">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Briefing */}
            <Card className="gap-3 lg:col-span-3">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-reef" />
                  <CardTitle className="text-base">Briefing</CardTitle>
                </div>
                <CardDescription>
                  Generated by the SeaSID agent with live weather, tide, and model output.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {briefing?.response ? (
                  <MarkdownResponse>{briefing.response}</MarkdownResponse>
                ) : (
                  <p className="text-sm text-muted-foreground">No briefing returned.</p>
                )}
                {briefing?.tool_calls && briefing.tool_calls.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Tools called ({briefing.tool_calls.length})
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {briefing.tool_calls.map((t, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Live features */}
            <Card className="gap-3 lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-reef" />
                  <CardTitle className="text-base">Live features</CardTitle>
                </div>
                <CardDescription>
                  Snapshot of the 11-feature vector for the current hour.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FeatureSnapshot parsed={parsed} weatherToolCall={wt} />
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Overall risk
                  </p>
                  <div className="mt-2">
                    <RiskBadge risk={parsed.overall_risk || 'unknown'} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {next12.length > 0 && (
            <PBadChart hours={next12} optimalIso={optimal?.ts} />
          )}
        </>
      )}
    </div>
  );
}

function FeatureSnapshot({ parsed, weatherToolCall }) {
  if (!parsed || Object.keys(parsed).length === 0) {
    return <p className="text-sm text-muted-foreground">No feature snapshot yet.</p>;
  }

  return (
    <dl className="divide-y divide-border">
      {METRIC_DEFS.map((m) => {
        const v =
          parsed.features?.[m.key] ??
          extractFromWeather(weatherToolCall, m.key);
        return (
          <div key={m.key} className="flex items-center justify-between py-2 text-sm">
            <dt className="text-muted-foreground">{m.label}</dt>
            <dd className="font-mono tabular-nums text-foreground">{fmt(v, m.unit)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function parseForecast(toolCall) {
  if (!toolCall) return {};
  try {
    return JSON.parse(toolCall.result || '{}');
  } catch {
    return {};
  }
}

function extractFromWeather(toolCall, key) {
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.result || '{}')?.weather?.[key];
  } catch {
    return null;
  }
}
