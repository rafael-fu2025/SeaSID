import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveInspectorData } from './useInspectorData';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Activity, Droplets, Wind, Thermometer, Gauge, MapPin,
  Calendar, Sparkles, Info,
} from 'lucide-react';

/**
 * Inspector — right rail of the SeaSID cockpit.
 *
 *  - Always shows route-specific live data (forecast KPIs, alert count,
 *    optimal window) regardless of which page is active.
 *  - Data hook pulls forecast+alerts for the currently selected site
 *    so the inspector is never empty while the rest of the app loads.
 *  - Tries hard not to be a "blank rectangle": the top always shows
 *    the selected site name, and at least one of AQI / wind / wave
 *    given the API response.
 *
 * Width is owned by the parent PanelGroup's resize handle; this
 * component just fills the panel.
 */
export function Inspector({ siteKey }) {
  const location = useLocation();
  const { data, loading, error } = useLiveInspectorData(siteKey);

  if (loading && !data) {
    return (
      <aside
        aria-label="Live inspector"
        className="flex h-full flex-col border-l border-border bg-card"
      >
        <Header />
        <ScrollArea className="flex-1 px-4">
          <div className="flex flex-col gap-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </ScrollArea>
      </aside>
    );
  }

  if (error && !data) {
    return (
      <aside
        aria-label="Live inspector"
        className="flex h-full flex-col border-l border-border bg-card"
      >
        <Header />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <Info className="mr-2 size-4" />
          <span>Inspector offline · start the API.</span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Live inspector"
      className="flex h-full flex-col border-l border-border bg-card"
    >
      <Header />

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 px-4 pb-6 pt-4">
          {/* Site + risk */}
          <section aria-labelledby="inspector-site">
            <h2 id="inspector-site" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Live at
            </h2>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-base font-semibold text-foreground">
                {data?.site_name ?? 'Dauin Muck'}
              </span>
              {data?.current_risk && (
                <RiskChip risk={data.current_risk} />
              )}
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              <span className="font-mono">{data?.site_key ?? siteKey}</span>
            </div>
          </section>

          <Separator />

          {/* KPI strip */}
          <section aria-labelledby="inspector-kpis">
            <h2 id="inspector-kpis" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Right now
            </h2>
            <KpiGrid data={data} />
          </section>

          <Separator />

          {/* Optimal window */}
          {data?.optimal_window && (
            <section aria-labelledby="inspector-optimal">
              <h2 id="inspector-optimal" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Optimal window
              </h2>
              <div className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-lg text-foreground">
                    {new Date(data.optimal_window.ts).toLocaleTimeString([], {
                      hour: '2-digit', minute: '2-digit', hour12: false,
                    })}
                  </span>
                  <Badge variant="secondary" className="font-mono">
                    {Math.round(data.optimal_window.p_bad * 100)}% P(no-go)
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <Sparkles className="mr-1 inline size-3 text-positive" />
                  {data.optimal_window.viz_label} ·{' '}
                  {new Date(data.optimal_window.ts).toLocaleString([], {
                    weekday: 'short', month: 'short', day: 'numeric',
                  })}
                </div>
              </div>
            </section>
          )}

          {/* Alerts summary */}
          <section aria-labelledby="inspector-alerts">
            <h2 id="inspector-alerts" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active alerts
            </h2>
            {data?.alert_count > 0 ? (
              <ul className="space-y-1.5">
                {data.top_alerts.map((a) => (
                  <li
                    key={`${a.kind}-${a.message}`}
                    className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                    <span className="truncate">
                      <span className="font-mono text-foreground">{a.kind}</span>{' '}
                      <span className="text-muted-foreground">{a.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                No active alerts · conditions nominal.
              </p>
            )}
          </section>

          <Separator />

          {/* Context note */}
          <p className="text-[11px] leading-snug text-muted-foreground">
            <Info className="mr-1 inline size-3 align-text-top" />
            Live inspector tracks <span className="font-mono text-foreground">{data?.site_key ?? siteKey}</span>.
            Switch sites in the page header to re-aim.
          </p>

          <span className="sr-only">On route: {location.pathname}</span>
        </div>
      </ScrollArea>
    </aside>
  );
}

function Header() {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Activity className="size-3.5 text-reef" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Inspector
        </h2>
      </div>
    </div>
  );
}

function RiskChip({ risk }) {
  const tone =
    risk === 'low' ? 'bg-positive/15 text-positive' :
    risk === 'moderate' ? 'bg-warning/15 text-warning' :
    'bg-danger/15 text-danger';
  return (
    <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider', tone)}>
      {risk}
    </span>
  );
}

function KpiGrid({ data }) {
  const items = [
    {
      label: 'P(no-go)',
      value: data?.p_bad != null ? `${Math.round(data.p_bad * 100)}%` : '—',
      tone: data?.p_bad >= 0.6 ? 'danger' : data?.p_bad >= 0.3 ? 'warning' : 'positive',
      Icon: Activity,
    },
    {
      label: 'AQI',
      value: data?.air?.available ? Math.round(data.air.aqi) : '—',
      tone: data?.air?.available && data.air.aqi >= 150 ? 'danger'
        : data?.air?.available && data.air.aqi >= 100 ? 'warning'
        : 'positive',
      Icon: Wind,
    },
    {
      label: 'Wind',
      value: data?.wind_max_kmh != null ? `${Math.round(data.wind_max_kmh)}` : '—',
      suffix: ' km/h',
      tone: 'foreground',
      Icon: Wind,
    },
    {
      label: 'Sea °C',
      value: data?.sea_temp_c?.toFixed?.(1) ?? '—',
      suffix: ' °C',
      tone: 'foreground',
      Icon: Thermometer,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ label, value, suffix, tone, Icon }) => (
        <Tooltip key={label}>
          <TooltipTrigger asChild>
            <div className="rounded-md border border-border bg-background p-2.5 transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <Icon className="size-3" />
                <span>{label}</span>
              </div>
              <div
                className={cn(
                  'mt-1 font-mono text-base tabular-nums',
                  tone === 'danger' && 'text-danger',
                  tone === 'warning' && 'text-warning',
                  tone === 'positive' && 'text-positive',
                  tone === 'foreground' && 'text-foreground',
                )}
              >
                {value}
                {suffix && <span className="ml-0.5 text-xs text-muted-foreground">{suffix}</span>}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left">{label} ({locationLabel(tone)})</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function locationLabel(tone) {
  switch (tone) {
    case 'danger': return 'threshold breach';
    case 'warning': return 'monitor';
    case 'positive': return 'within limit';
    default: return 'live';
  }
}
