import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '@/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Map as MapIcon, AlertTriangle, Crosshair, Lock } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { RiskBadge } from '@/components/RiskBadge';
import { FreshnessStack } from '@/components/FreshnessBadge';
import { ForecastProvenance } from '@/components/ForecastProvenance';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/ThemeContext';

/**
 * MapPage — OpenStreetMap view with site markers and a P(no-go) heat-radius.
 *
 *  - Pure Leaflet; no wrapper lib.
 *  - Tile server: OpenStreetMap (no API key).
 *  - Heat radius is drawn as concentric circles around each site; colour
 *    encodes the per-site risk band.
 *  - Site cards under the map show the same data in tabular form for
 *    keyboard / non-map users.
 *  - Listens for the global ``seasid:refresh`` event so a completed
 *    experiment suite (which the backend reloads with fresh weights
 *    and invalidates the per-site forecast cache) immediately re-renders
 *    the heat radii + per-site cards against the new model — every
 *    site, one parallel batch, no manual refresh needed.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap contributors';
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const DARK_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const RISK_COLOR = {
  low:      '#6cca8f',
  moderate: '#e0a062',
  high:     '#e07279',
  unknown:  '#94a3b8',
};

function riskLevel(p) {
  if (p == null) return 'unknown';
  if (p >= 0.6) return 'high';
  if (p >= 0.3) return 'moderate';
  return 'low';
}

function fmt(n, digits = 4) { return Number(n).toFixed(digits); }
function fmtPct(p) { return p == null ? '—' : `${Math.round(p * 100)}%`; }

export default function MapPage() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const layerGroupRef = useRef(null);
  const pulsesRef = useRef([]);
  const tileLayerRef = useRef(null);

  const { theme } = useTheme();

  const [sites, setSites] = useState([]);
  const [forecasts, setForecasts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoomUnlocked, setZoomUnlocked] = useState(false);
  // Token checked on every async callback so an unmount or stale refresh
  // burst (e.g. ``seasid:refresh`` firing repeatedly while a run is in
  // progress) doesn't overwrite newer state with an old payload.
  const fetchTokenRef = useRef(0);

  // Pull sites + forecasts in parallel. Lives in a useCallback so the
  // ``seasid:refresh`` listener below can fire the same fetcher when an
  // experiment suite finishes and re-trains the active model.
  const loadData = useCallback(async ({ silent = false } = {}) => {
    const token = ++fetchTokenRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const s = await api.getSites();
      if (token !== fetchTokenRef.current) return;
      setSites(s || []);
      const pairs = await Promise.allSettled(
        (s || []).map((site) =>
          api.getForecast(site.key).then((fc) => [site.key, fc]).catch(() => [site.key, null]),
        ),
      );
      if (token !== fetchTokenRef.current) return;
      const map = {};
      for (const p of pairs) if (p.status === 'fulfilled') map[p.value[0]] = p.value[1];
      setForecasts(map);
    } catch (err) {
      if (token !== fetchTokenRef.current) return;
      setError(err.message);
    } finally {
      if (token === fetchTokenRef.current && !silent) setLoading(false);
    }
  }, []);

  // Initial load on mount.
  useEffect(() => {
    loadData();
    return () => { fetchTokenRef.current += 1; };
  }, [loadData]);

  // Background refresh whenever any cockpit page broadcasts
  // ``seasid:refresh`` — notably fired by the Experiments page after the
  // experiment suite's ``done`` event, which is exactly when the backend
  // has reloaded the active model and dropped the cached forecasts.
  useEffect(() => {
    const onRefresh = () => { loadData({ silent: true }); };
    window.addEventListener('seasid:refresh', onRefresh);
    return () => window.removeEventListener('seasid:refresh', onRefresh);
  }, [loadData]);

  // Build Leaflet map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [9.12, 123.27],
      zoom: 11,
      // All zoom interactions are off until the user explicitly opts in via
      // the click-to-enable overlay. This prevents accidental scroll-zoom
      // while the user is reading the page or scrolling past the map.
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
      zoomControl: true,
    });
    // Track the tile layer so the theme-swap effect can replace it with a
    // dark variant without recreating the entire Leaflet map instance.
    tileLayerRef.current = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // Swap tile providers when the user toggles between light and dark theme.
  // We keep the same Leaflet map instance alive; only the L.tileLayer is
  // replaced so the rest of the markers, scroll-disable state, etc. are
  // untouched. CartoDB's basemaps mirror OpenStreetMap data and provide a
  // free dark variant suitable for our dashboard theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L.tileLayer !== 'function') return;
    const previous = tileLayerRef.current;
    const isDark = theme === 'dark';
    const url = isDark ? DARK_TILE_URL : TILE_URL;
    const attribution = isDark ? DARK_ATTRIBUTION : ATTRIBUTION;
    const next = L.tileLayer(url, { attribution, maxZoom: 18, subdomains: 'abcd' }).addTo(map);
    tileLayerRef.current = next;
    if (previous && typeof previous.remove === 'function') {
      try { previous.remove(); } catch (_) { /* ignore */ }
    }
  }, [theme]);

  // Re-measure Leaflet when the viewport changes. The agent Sheet is a
  // modal overlay, so it does not change this container's dimensions.
  // Invalidating the map while that overlay opens can make its tile layer
  // repaint blank; leave the map alone until a real resize occurs.
  useEffect(() => {
    const invalidate = () => {
      const m = mapRef.current;
      if (!m || typeof m.invalidateSize !== 'function') return;
      // Defer one frame so any CSS transition on the Sheet has settled
      // before Leaflet re-measures. Otherwise we still get a stale size.
      requestAnimationFrame(() => m.invalidateSize());
    };
    const onResize = () => invalidate();
    window.addEventListener('resize', onResize);
    // Also invalidate once on mount in case the container's final size
    // arrives after Leaflet's first measurement (common when the page
    // mounts before the cockpit's right rail has sized itself).
    invalidate();
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // (Re)draw markers + heat circles when data changes.
  useEffect(() => {
    const group = layerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();
    pulsesRef.current.forEach((p) => p.stop());
    pulsesRef.current = [];

    const bounds = [];
    const PULSE_AMPLITUDE_BY_LEVEL = { high: 600, moderate: 400, low: 220 };
    const PULSE_PERIOD_MS = 2200;

    for (const site of sites) {
      const fc = forecasts[site.key];
      const cur = fc?.hours?.[0];
      const p = cur?.p_bad ?? null;
      const level = riskLevel(p);
      const color = RISK_COLOR[level];

      // Larger, easy-to-read heat radius. The outer halo is widened in
      // proportion so the risk band is obvious at the default zoom level.
      const innerR = p == null ? 320 : 380 + p * 2000;
      const outerR = innerR + 600;

      L.circle([site.lat, site.lon], {
        radius: outerR, color, fillColor: color, fillOpacity: 0.10, weight: 0, interactive: false,
      }).addTo(group);
      const innerCircle = L.circle([site.lat, site.lon], {
        radius: innerR, color, fillColor: color, fillOpacity: 0.22, weight: 0, interactive: false,
      }).addTo(group);

      // Radar-style pulse: smoothly grow/shrink the inner heat radius on a
      // requestAnimationFrame loop. Amplitude scales with risk severity so
      // higher-risk sites draw the eye. The loop is cancelled on cleanup
      // and on every re-render via the pulsesRef registry.
      const amplitude = PULSE_AMPLITUDE_BY_LEVEL[level] ?? 180;
      let rafId = 0;
      let startTs = 0;
      const tick = (ts) => {
        if (!startTs) startTs = ts;
        const t = ((ts - startTs) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
        const eased = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
        try {
          innerCircle.setRadius(innerR + amplitude * eased);
        } catch (_) {
          /* layer removed mid-frame; the outer useEffect cleanup will stop us */
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      pulsesRef.current.push({ stop: () => cancelAnimationFrame(rafId) });

      const air = fc?.air;
      const airLine = air?.available
        ? `<div class="map-popup__row"><span>Air (AQI)</span><strong>${Math.round(air.aqi)} · ${escapeHtml(air.station_name ?? '—')}</strong></div>`
        : '';
      const popupHtml = `
        <div class="map-popup">
          <p class="map-popup__title">${escapeHtml(site.name)}</p>
          <div class="map-popup__row"><span>Type</span><strong>${escapeHtml(site.type)}</strong></div>
          <div class="map-popup__row"><span>P(no-go)</span><strong>${fmtPct(p)}</strong></div>
          <div class="map-popup__row"><span>Visibility</span><strong>${escapeHtml(cur?.viz_label ?? '—')}</strong></div>
          <div class="map-popup__row"><span>Current</span><strong>${escapeHtml(cur?.current_risk ?? '—')}</strong></div>
          ${airLine}
          <div class="map-popup__row"><span>Coords</span><strong>${fmt(site.lat)}, ${fmt(site.lon)}</strong></div>
          <div class="map-popup__hint">Hover for a quick read; click for full details →</div>
        </div>
      `;

      // Compact hover tooltip on top of the existing click popup. Leaflet
      // shows the tooltip on mouseover and the popup on click by default,
      // so users get a preview while moving toward the click target.
      const tooltipHtml = `
        <div class="map-tooltip">
          <p class="map-tooltip__title">${escapeHtml(site.name)}</p>
          <div class="map-tooltip__row"><span>P(no-go)</span><strong>${fmtPct(p)}</strong></div>
          <div class="map-tooltip__row"><span>Current</span><strong>${escapeHtml(cur?.current_risk ?? '—')}</strong></div>
          ${air?.available ? `<div class="map-tooltip__row"><span>Air</span><strong>${Math.round(air.aqi)}</strong></div>` : ''}
          <div class="map-tooltip__hint">Click for full details →</div>
        </div>
      `;

      L.marker([site.lat, site.lon])
        .bindTooltip(tooltipHtml, {
          className: 'map-site-tooltip',
          direction: 'top',
          offset: [0, -14],
          opacity: 1,
          sticky: true,
        })
        .bindPopup(popupHtml, { className: 'map-site-marker-popup' })
        .addTo(group);
      bounds.push([site.lat, site.lon]);
    }

    if (bounds.length >= 1) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  }, [sites, forecasts]);

  // Stop any in-flight pulse animations when the map unmounts so the
  // requestAnimationFrame loops don't keep running against removed layers.
  useEffect(() => () => {
    pulsesRef.current.forEach((p) => p.stop());
    pulsesRef.current = [];
  }, []);

  // Click-to-enable interaction model: zoom, scroll, drag, and double-click
  // are intentionally inert until the user opts in, so accidental scrolls
  // across the map never change the view.
  const enableMapInteraction = () => {
    const m = mapRef.current;
    if (!m) return;
    const unlock = (handler) => {
      if (handler && typeof handler.enable === 'function') {
        try { handler.enable(); } catch (_) { /* harmless in test envs */ }
      }
    };
    unlock(m.scrollWheelZoom);
    unlock(m.doubleClickZoom);
    unlock(m.boxZoom);
    unlock(m.touchZoom);
    if (m.dragging && typeof m.dragging.enable === 'function') {
      try { m.dragging.enable(); } catch (_) { /* ignore */ }
    }
    setZoomUnlocked(true);
  };

  const lockMapInteraction = () => {
    const m = mapRef.current;
    if (!m) return;
    const lock = (handler) => {
      if (handler && typeof handler.disable === 'function') {
        try { handler.disable(); } catch (_) { /* harmless in test envs */ }
      }
    };
    lock(m.scrollWheelZoom);
    lock(m.doubleClickZoom);
    lock(m.boxZoom);
    lock(m.touchZoom);
    if (m.dragging && typeof m.dragging.disable === 'function') {
      try { m.dragging.disable(); } catch (_) { /* ignore */ }
    }
    setZoomUnlocked(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Map</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Geographic view of every dive site on OpenStreetMap, with a P(no-go) heat-radius overlay.
        </p>
      </header>

      {/* Provenance strip — same data_as_of as the Dashboard so the two
          screens agree (roadmap #8 acceptance criterion). */}
      {Object.values(forecasts).filter(Boolean)[0] && (
        <ForecastProvenance
          dataAsOf={Object.values(forecasts).filter(Boolean)[0].data_as_of}
          freshness={Object.values(forecasts).filter(Boolean)[0].freshness}
          providers={Object.values(forecasts).filter(Boolean)[0].providers}
          modelVersion={Object.values(forecasts).filter(Boolean)[0].model_version}
          generatedAt={Object.values(forecasts).filter(Boolean)[0].generated_at}
          compact
        />
      )}

      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-danger" />
            <div className="text-sm">
              <p className="font-medium text-danger">Could not load sites</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/*
        Leaflet's panes use high z-index values for markers and controls.
        Isolate them in this low stacking context so Radix's Sheet backdrop
        remains above the whole map, just like it is above the other content.
      */}
      <Card className="relative z-0 w-full min-w-0 overflow-hidden p-0">
        <CardHeader className="border-b border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MapIcon className="size-4 text-reef" />
              Live conditions
            </CardTitle>
            <LegendInline />
          </div>
        </CardHeader>
        <div className="relative h-[480px] w-full max-w-full">
          <div
            ref={containerRef}
            className="absolute inset-0"
            data-testid="leaflet-map"
          />
          {!zoomUnlocked && (
            <button
              type="button"
              data-testid="map-enable-overlay"
              onClick={enableMapInteraction}
              aria-label="Click to enable map zoom and scroll"
              className="absolute inset-0 z-[1000] flex cursor-pointer items-center justify-center bg-foreground/15 backdrop-blur-[2px] transition-opacity hover:bg-foreground/20"
            >
              <span className="flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground shadow-md ring-1 ring-border">
                <Crosshair className="size-4 text-reef" />
                Click to enable zoom &amp; scroll
              </span>
            </button>
          )}
          {zoomUnlocked && (
            <button
              type="button"
              data-testid="map-lock-toggle"
              onClick={lockMapInteraction}
              aria-label="Lock map to disable zoom and scroll"
              className="absolute bottom-3 left-3 z-[600] rounded-md bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow ring-1 ring-border transition-colors hover:bg-background"
            >
              <Lock className="mr-1 inline-block size-3" aria-hidden="true" /> Lock map
            </button>
          )}
        </div>
      </Card>

      {/* Site list */}
      <section>
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Sites on this map</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Live P(no-go) per site · hover a marker for a quick read, click for full details.
            </p>
          </div>
          <Badge variant="secondary" className="font-mono">
            {sites.length} site{sites.length === 1 ? '' : 's'}
          </Badge>
        </header>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="map-skeleton-list">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-2 h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sites.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              <Crosshair className="mx-auto mb-2 size-5 text-muted-foreground/50" />
              No sites registered.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="map-site-list">
            {sites.map((site) => (
              <SiteTile key={site.key} site={site} forecast={forecasts[site.key]} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LegendInline() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <LegendDot color={RISK_COLOR.low} label="Low" />
      <LegendDot color={RISK_COLOR.moderate} label="Moderate" />
      <LegendDot color={RISK_COLOR.high} label="High" />
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block size-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 0 3px ${color}33` }}
      />
      <span>{label}</span>
    </span>
  );
}

function SiteTile({ site, forecast }) {
  const cur = forecast?.hours?.[0];
  const pBad = cur?.p_bad ?? null;
  const level = riskLevel(pBad);
  const air = forecast?.air;

  return (
    <Card data-testid={`map-site-${site.key}`}>
      <CardContent className="p-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
              {site.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{site.description}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {site.type} · {fmt(site.lat, 4)}, {fmt(site.lon, 4)}
            </p>
          </div>
          <span
            aria-hidden
            className={cn(
              'mt-1 inline-block size-2.5 shrink-0 rounded-full',
              level === 'high' && 'bg-danger shadow-[0_0_0_4px_rgba(224,114,121,0.18)]',
              level === 'moderate' && 'bg-warning shadow-[0_0_0_4px_rgba(224,160,98,0.18)]',
              level === 'low' && 'bg-positive shadow-[0_0_0_4px_rgba(108,202,143,0.18)]',
              level === 'unknown' && 'bg-muted-foreground',
            )}
          />
        </header>

        <Separator className="my-3" />

        <div className="grid grid-cols-2 gap-3">
          <Metric label="P(no-go)" value={fmtPct(pBad)} tone={level} />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</div>
            <div className="mt-1">
              <RiskBadge risk={cur?.current_risk || 'unknown'} />
            </div>
          </div>
        </div>

        {air?.available ? (
          <>
            <Separator className="my-3" />
            <div
              className="grid grid-cols-2 gap-3"
              data-testid={`map-air-${site.key}`}
            >
              <Metric
                label="Air (AQI)"
                value={Math.round(air.aqi)}
                tone={air.aqi >= 150 ? 'high' : air.aqi >= 100 ? 'moderate' : 'low'}
              />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Station
                </div>
                <p className="mt-1 truncate text-xs text-foreground">
                  {air.station_name || '—'}
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Air quality data not configured for this site.
          </p>
        )}

        {/* Per-source freshness chips (roadmap #8) */}
        {forecast?.freshness?.length > 0 && (
          <div className="mt-3">
            <FreshnessStack
              freshness={forecast.freshness}
              degradedReasons={forecast.degraded}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-base tabular-nums',
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
