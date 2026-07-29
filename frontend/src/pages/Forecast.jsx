import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ChevronDown, Clock3, Database, RefreshCw, Sparkles,
} from 'lucide-react';
import { api, streamBriefing } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton, SkeletonChart } from '@/components/Skeleton';
import { PBadChart } from '@/components/PBadChart';
import { RiskBadge } from '@/components/RiskBadge';
import { SiteSelector } from '@/components/SiteSelector';
import MarkdownResponse from '@/components/MarkdownResponse';
import { StreamingDots } from '@/components/agent/StreamingDots';
import {
  makeThinkingState, feedThinking, flushThinking,
} from '@/components/agent/streaming-thinking';
import {
  clearForecastCache, readForecastCache, writeForecastCache,
} from '@/lib/forecastCache';

const METRIC_DEFS = [
  { key: 'precip_24h_mm', label: 'Precip · 24h', unit: 'mm' },
  { key: 'precip_recent_3h', label: 'Precip · 3h', unit: 'mm' },
  { key: 'wind_max_kmh', label: 'Wind max', unit: 'km/h' },
  { key: 'wave_max_m', label: 'Wave max', unit: 'm' },
  { key: 'sea_temp_c', label: 'Sea temp', unit: '°C' },
  { key: 'tide_range_m', label: 'Tide range', unit: 'm' },
];

const fmt = (value, unit) => {
  if (value == null) return '—';
  const decimals = unit === 'm' || unit === '°C' ? 1 : 0;
  return `${Number(value).toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
};

export default function Forecast() {
  const [selectedSite, setSelectedSite] = useState('dauin_muck');
  const [briefing, setBriefing] = useState(null);
  const [briefingStreaming, setBriefingStreaming] = useState(false);
  const [briefingError, setBriefingError] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [windowHours, setWindowHours] = useState(48);
  const [cacheAge, setCacheAge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);
  // AbortController for the in-flight briefing stream so a site switch,
  // manual refresh, or unmount can cancel it instead of letting stale
  // deltas race the new request.
  const streamRef = useRef(null);

  const load = useCallback(async (siteKey, { force = false } = {}) => {
    const requestId = ++requestRef.current;
    setError(null);
    setBriefingError(null);
    if (!force) {
      const cached = readForecastCache(siteKey);
      if (cached) {
        setBriefing(cached.briefing);
        setForecast(cached.forecast);
        setCacheAge(Date.now() - cached.savedAt);
        setLoading(false);
        return;
      }
    }

    streamRef.current?.abort();
    const controller = new AbortController();
    streamRef.current = controller;

    setBriefing(null);
    setBriefingStreaming(true);

    // The numeric forecast is fast (LSTM inference) while the briefing is a
    // slow LLM turn — fetch them independently so the charts render the
    // moment the forecast lands instead of blocking on the agent.
    const forecastPromise = api.getForecast(siteKey, 48)
      .then((next) => {
        if (requestRef.current !== requestId) return null;
        setForecast(next);
        setCacheAge(0);
        setLoading(false);
        return next;
      })
      .catch((err) => {
        if (requestRef.current === requestId) setError(err.message);
        return null;
      });

    // Assemble the briefing incrementally from the SSE stream. `draft`
    // mirrors the blocking BriefingResponse shape ({response, tool_calls})
    // so the render path and the forecast cache stay format-compatible.
    const draft = { response: '', tool_calls: [], site_key: siteKey, type: 'briefing' };
    const think = makeThinkingState();
    let failed = false;
    const pushDraft = () => {
      setBriefing({ ...draft, tool_calls: [...draft.tool_calls] });
      setLoading(false);
    };

    try {
      for await (const ev of streamBriefing({ siteKey, signal: controller.signal })) {
        if (requestRef.current !== requestId) break;
        switch (ev.type) {
          case 'text': {
            // Route <think> blocks out of the visible briefing with the
            // same state machine the agent chat uses (the blocking
            // endpoint strips them server-side via strip_internal_thoughts).
            const split = feedThinking(think, ev.delta);
            if (split.visible) {
              draft.response += split.visible;
              pushDraft();
            }
            break;
          }
          case 'tool_call':
            draft.tool_calls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
            pushDraft();
            break;
          case 'tool_result':
            draft.tool_calls = draft.tool_calls.map((tc) =>
              tc.id === ev.id ? { ...tc, result: ev.output } : tc,
            );
            pushDraft();
            break;
          case 'done': {
            const tail = flushThinking(think);
            if (tail.visible) draft.response += tail.visible;
            // The terminal event carries the consolidated tool log in the
            // exact {name, arguments, result} shape the blocking endpoint
            // returns — prefer it over our incrementally-patched list.
            if (Array.isArray(ev.tool_calls) && ev.tool_calls.length > 0) {
              draft.tool_calls = ev.tool_calls;
            }
            pushDraft();
            break;
          }
          case 'error':
            failed = true;
            if (requestRef.current === requestId) {
              setBriefingError(ev.message || 'Briefing unavailable');
            }
            break;
          default:
            break;
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError' && requestRef.current === requestId) {
        failed = true;
        setBriefingError(err.message);
      }
    } finally {
      if (requestRef.current === requestId) setBriefingStreaming(false);
      if (streamRef.current === controller) streamRef.current = null;
    }

    const nextForecast = await forecastPromise;
    if (requestRef.current !== requestId) return;
    setLoading(false);
    // Cache only complete, successful snapshots so a half-streamed or
    // errored briefing never gets restored as if it were finished.
    if (!failed && draft.response && nextForecast) {
      writeForecastCache(siteKey, { briefing: draft, forecast: nextForecast });
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(selectedSite);
    return () => {
      requestRef.current += 1;
      streamRef.current?.abort();
    };
  }, [selectedSite, load]);

  useEffect(() => {
    const handler = () => {
      clearForecastCache(selectedSite);
      setRefreshing(true);
      load(selectedSite, { force: true }).finally(() => setRefreshing(false));
    };
    window.addEventListener('seasid:refresh', handler);
    return () => window.removeEventListener('seasid:refresh', handler);
  }, [selectedSite, load]);

  const refresh = () => {
    clearForecastCache(selectedSite);
    setRefreshing(true);
    load(selectedSite, { force: true }).finally(() => setRefreshing(false));
  };

  const forecastCall = briefing?.tool_calls?.find((tool) => tool.name === 'get_forecast');
  const weatherCall = briefing?.tool_calls?.find((tool) => tool.name === 'get_weather');
  const current = parseToolResult(forecastCall);
  const hours = (forecast?.hours || []).slice(0, windowHours);
  const optimal = forecast?.optimal_window;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Forecast</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI guidance and LSTM risk outlook for the next 48 hours.
          </p>
          {briefingStreaming ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Database className="size-3 text-reef" aria-hidden />
              Briefing streaming live…
            </p>
          ) : briefing && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Database className="size-3 text-reef" aria-hidden />
              {cacheAge > 0
                ? `Restored from cache · ${Math.max(1, Math.round(cacheAge / 1000))}s old`
                : 'Freshly updated'}
            </p>
          )}
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
            {refreshing
              ? <Skeleton className="size-3.5 rounded-full" />
              : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-danger" />
            <div className="text-sm">
              <p className="font-medium text-danger">Forecast unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !briefing ? (
        <div className="flex flex-col gap-6"><SkeletonChart /><SkeletonChart /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Card className="gap-3 transition-shadow hover:shadow-md lg:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-reef" /> Dive briefing
                </CardTitle>
                <CardDescription>Generated from live tools and the active LSTM forecast.</CardDescription>
              </CardHeader>
              <CardContent>
                {briefing?.response ? (
                  <>
                    <MarkdownResponse>{briefing.response}</MarkdownResponse>
                    {briefingStreaming && (
                      <div
                        className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                        data-testid="briefing-streaming"
                      >
                        <StreamingDots />
                        <span>Writing…</span>
                      </div>
                    )}
                  </>
                ) : briefingStreaming ? (
                  <div
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                    data-testid="briefing-streaming"
                  >
                    <StreamingDots />
                    <span>Generating briefing…</span>
                  </div>
                ) : briefingError ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-danger">Briefing unavailable.</span>{' '}
                    {briefingError}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No briefing returned.</p>
                )}
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {(briefing?.tool_calls || []).map((tool, index) => (
                    <Badge key={`${tool.name}-${index}`} variant="secondary" className="font-mono text-[10px]">
                      {tool.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="gap-3 transition-shadow hover:shadow-md lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="size-4 text-reef" /> Live metrics
                </CardTitle>
                <CardDescription>Expand the timeline below for hour-specific details.</CardDescription>
              </CardHeader>
              <CardContent>
                <FeatureSnapshot parsed={current} weatherToolCall={weatherCall} />
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Current risk
                  </p>
                  <RiskBadge risk={current.overall_risk || hours[0]?.risk || 'unknown'} />
                </div>
              </CardContent>
            </Card>
          </div>

          {hours.length > 0 && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Forecast timeline</h2>
                  <p className="text-xs text-muted-foreground">Select a range or expand any hour.</p>
                </div>
                <WindowToggle value={windowHours} onChange={setWindowHours} />
              </div>
              <PBadChart
                hours={hours}
                optimalIso={optimal?.ts}
                label={`${windowHours}-hour probability of no-go`}
              />
              <ForecastTimeline hours={hours} optimalIso={optimal?.ts} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function WindowToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted/40 p-1" aria-label="Forecast window">
      {[12, 24, 48].map((hours) => (
        <button
          key={hours}
          type="button"
          onClick={() => onChange(hours)}
          className={[
            'rounded px-3 py-1.5 text-xs font-medium transition-all duration-200',
            value === hours
              ? 'bg-reef text-reef-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          ].join(' ')}
          aria-pressed={value === hours}
        >
          {hours}h
        </button>
      ))}
    </div>
  );
}

function ForecastTimeline({ hours, optimalIso }) {
  return (
    <div
      className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3"
      data-testid="forecast-timeline"
    >
      {hours.map((hour, index) => {
        const probability = Math.round(Number(hour.p_bad || 0) * 100);
        const optimal = hour.ts === optimalIso;
        return (
          <details
            key={hour.ts}
            className={[
              'group rounded-md border bg-card transition-all duration-200',
              'hover:-translate-y-0.5 hover:border-reef/50 hover:shadow-md',
              optimal ? 'border-reef/60 ring-1 ring-reef/20' : 'border-border',
            ].join(' ')}
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
              <div className="rounded bg-muted p-2 text-muted-foreground transition-colors group-hover:text-reef">
                <Clock3 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">
                  {new Date(hour.ts).toLocaleString([], {
                    weekday: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Hour {index + 1} · {hour.viz_label || 'Visibility pending'}
                </p>
              </div>
              {optimal && <Badge variant="outline" className="border-positive/40 text-positive">Best</Badge>}
              <Badge
                variant="outline"
                className={
                  probability >= 60
                    ? 'border-danger/40 bg-danger/10 text-danger'
                    : probability >= 30
                      ? 'border-warning/40 bg-warning/10 text-warning'
                      : 'border-positive/40 bg-positive/10 text-positive'
                }
              >
                {probability}%
              </Badge>
              <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-2 gap-2 border-t border-border px-3 py-2 text-xs">
              <MetricDetail label="Risk" value={hour.risk || 'Unknown'} />
              <MetricDetail label="Current" value={hour.current_risk || 'Unknown'} />
              <MetricDetail label="Model" value={hour.model_used || 'LSTM'} />
              <MetricDetail label="Time" value={new Date(hour.ts).toLocaleTimeString()} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function MetricDetail({ label, value }) {
  return (
    <div className="rounded bg-muted/50 px-2 py-1.5" title={`${label}: ${value}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium text-foreground">{value}</p>
    </div>
  );
}

function FeatureSnapshot({ parsed, weatherToolCall }) {
  if (!parsed || Object.keys(parsed).length === 0) {
    return <p className="text-sm text-muted-foreground">No feature snapshot yet.</p>;
  }
  return (
    <dl className="divide-y divide-border">
      {METRIC_DEFS.map((metric) => {
        const value = parsed.features?.[metric.key] ?? extractFromWeather(weatherToolCall, metric.key);
        return (
          <div key={metric.key} className="flex items-center justify-between py-2 text-sm">
            <dt className="text-muted-foreground">{metric.label}</dt>
            <dd className="font-mono tabular-nums text-foreground">{fmt(value, metric.unit)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function parseToolResult(toolCall) {
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
