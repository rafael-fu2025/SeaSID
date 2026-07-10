import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveInspectorData } from './useInspectorData';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  Activity, Droplets, Wind, Thermometer, MapPin,
  Sparkles, Info, PanelRightClose, PanelRightOpen, AlertTriangle,
} from 'lucide-react';

/**
 * Inspector — right rail of the SeaSID cockpit.
 *
 * Two-mode design:
 *
 *   expanded   (default ~360 px)
 *     - "Inspector" header + collapse button.
 *     - LIVE AT · selected site, current risk chip.
 *     - RIGHT NOW · 2×2 KPI grid (P(no-go), AQI, Wind, Sea °C).
 *     - OPTIMAL WINDOW · reef-bordered card with time + P(no-go).
 *     - ACTIVE ALERTS · list (or "No active alerts · conditions
 *       nominal." when there are none).
 *     - Context footer pointing at the active site.
 *
 *   collapsed  (default ~56 px)
 *     - Tiny vertical strip with: API pulse, alert count, optimal
 *       P(no-go) %. Always enough to know "is the cockpit healthy?"
 *     - A `PanelRightOpen` chevron at the top restores the panel.
 *
 * Width is owned by the parent Layout's ResizablePanel; this component
 * just renders the appropriate variant and forwards the toggle.
 */
export function Inspector({
  siteKey = 'dauin_muck',
  collapsed = false,
  onToggle,
  hideCollapseChevron = false,
}) {
  const location = useLocation();
  const { data, loading, error } = useLiveInspectorData(siteKey);
  const canvasRef = useRef(null);

  // Pass-through for imperative resize when content updates (best effort).
  const [, setTick] = useState(0);
  useEffect(() => { setTick((n) => n + 1); }, [data]);

  if (collapsed) return <CollapsedInspector data={data} loading={loading} error={error} onToggle={onToggle} />;

  return (
    <aside
      aria-label="Live inspector"
      className="flex h-full flex-col border-l border-border bg-card"
    >
      <Header onToggle={onToggle} hideCollapseChevron={hideCollapseChevron} />

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 px-4 pb-6 pt-4">
          {/* Site + risk */}
          <section aria-labelledby="inspector-site">
            <h2 id="inspector-site" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Live at
            </h2>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-base font-semibold tracking-tight text-foreground">
                {data?.site_name ?? (loading ? '…' : 'Dauin Muck')}
              </span>
              {data?.current_risk && <RiskChip risk={data.current_risk} />}
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
            {error && !data ? (
              <p className="text-xs text-muted-foreground">
                <Info className="mr-1 inline size-3 align-text-top" />
                Inspector offline — start the API.
              </p>
            ) : loading && !data ? (
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <KpiGrid data={data} />
            )}
          </section>

          <Separator />

          {/* Optimal window */}
          {data?.optimal_window && (
            <section aria-labelledby="inspector-optimal">
              <h2 id="inspector-optimal" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Optimal window
              </h2>
              <div className="rounded-md border border-reef/40 bg-background p-3" data-testid="inspector-optimal-card">
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

          {/* Alerts */}
          <section aria-labelledby="inspector-alerts">
            <h2 id="inspector-alerts" className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active alerts
            </h2>
            {data && data.alert_count > 0 ? (
              <ul className="space-y-1.5">
                {data.top_alerts.map((a) => (
                  <li
                    key={`${a.kind}-${a.message}`}
                    className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    data-testid="inspector-alert-row"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
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

          <p className="text-[11px] leading-snug text-muted-foreground">
            <Info className="mr-1 inline size-3 align-text-top" />
            Live inspector tracks{' '}
            <span className="font-mono text-foreground">{data?.site_key ?? siteKey}</span>.
            Switch sites in the page header to re-aim.
          </p>

          <span className="sr-only">On route: {location.pathname}</span>
        </div>
      </ScrollArea>
    </aside>
  );
}

function Header({ onToggle, hideCollapseChevron }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <Activity className="size-3.5 text-reef" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">Inspector</h2>
      </div>
      {!hideCollapseChevron && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse inspector"
              aria-pressed={false}
              data-testid="inspector-collapse"
              className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <PanelRightClose className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Collapse inspector</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function CollapsedInspector({ data, loading, error, onToggle, hideCollapseChevron }) {
  const apiOk = !error && (data || loading);
  const alertCount = data?.alert_count ?? 0;
  const optimalPct = data?.optimal_window
    ? Math.round(data.optimal_window.p_bad * 100)
    : null;

  return (
    <aside
      aria-label="Live inspector"
      data-collapsed="true"
      className="flex h-full flex-col items-stretch border-l border-border bg-card"
    >
      {!hideCollapseChevron && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Expand inspector"
              aria-pressed={true}
              data-testid="inspector-expand"
              className="mx-auto mt-2 inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <PanelRightOpen className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Expand inspector</TooltipContent>
        </Tooltip>
      )}

      <Separator className="mx-2 mt-2" />

      {/* Vertical status strip */}
      <div className="flex flex-1 flex-col items-center gap-3 py-4 text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden
              className={cn(
                'inline-flex size-2 rounded-full',
                apiOk ? 'bg-positive shadow-[0_0_0_4px_rgba(108,202,143,0.18)]' : 'bg-danger shadow-[0_0_0_4px_rgba(224,114,121,0.18)]',
              )}
              data-testid="inspector-collapsed-api"
            />
          </TooltipTrigger>
          <TooltipContent side="left">{apiOk ? 'API online' : 'API offline'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center" data-testid="inspector-collapsed-alerts">
              <AlertTriangle className="size-3.5 text-warning" aria-hidden />
              <span className="mt-0.5 font-mono text-xs tabular-nums text-foreground">{alertCount}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left">{alertCount} active alert{alertCount === 1 ? '' : 's'}</TooltipContent>
        </Tooltip>

        {optimalPct !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col items-center" data-testid="inspector-collapsed-optimal">
                <Sparkles className="size-3.5 text-positive" aria-hidden />
                <span className="mt-0.5 font-mono text-[10px] tabular-nums text-foreground">{optimalPct}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">Optimal P(no-go): {optimalPct}%</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Bottom hint */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mx-auto mb-2 inline-flex size-6 items-center justify-center text-muted-foreground" aria-hidden>
            <Info className="size-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">Live inspector</TooltipContent>
      </Tooltip>
    </aside>
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
        <div key={label} className="rounded-md border border-border bg-background p-2.5 transition-colors hover:bg-muted/40">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
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
      ))}
    </div>
  );
}
