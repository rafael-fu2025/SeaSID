import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, AlertTriangle, Crosshair } from 'lucide-react';
import { api } from '@/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RiskBadge } from '@/components/RiskBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * MapPage — OpenStreetMap view with site markers and a P(no-go) heat-radius.
 *
 *  - Pure Leaflet; no wrapper lib.
 *  - Tile server: OpenStreetMap (no API key).
 *  - Heat radius is drawn as concentric circles around each site; colour
 *    encodes the per-site risk band.
 *  - Site cards under the map show the same data in tabular form for
 *    keyboard / non-map users.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap contributors';

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

  const [sites, setSites] = useState([]);
  const [forecasts, setForecasts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pull sites + forecasts in parallel.
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api.getSites()
      .then(async (s) => {
        if (cancel) return;
        setSites(s || []);
        const pairs = await Promise.allSettled(
          (s || []).map((site) =>
            api.getForecast(site.key).then((fc) => [site.key, fc]).catch(() => [site.key, null]),
          ),
        );
        if (cancel) return;
        const map = {};
        for (const p of pairs) if (p.status === 'fulfilled') map[p.value[0]] = p.value[1];
        setForecasts(map);
      })
      .catch((err) => { if (!cancel) setError(err.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  // Build Leaflet map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [9.12, 123.27],
      zoom: 11,
      scrollWheelZoom: true,
      zoomControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerGroupRef.current = null; };
  }, []);

  // (Re)draw markers + heat circles when data changes.
  useEffect(() => {
    const group = layerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();

    const bounds = [];
    for (const site of sites) {
      const fc = forecasts[site.key];
      const cur = fc?.hours?.[0];
      const p = cur?.p_bad ?? null;
      const level = riskLevel(p);
      const color = RISK_COLOR[level];

      const innerR = p == null ? 0 : 220 + p * 1200;
      const outerR = innerR + 350;

      L.circle([site.lat, site.lon], {
        radius: outerR, color, fillColor: color, fillOpacity: 0.10, weight: 0, interactive: false,
      }).addTo(group);
      L.circle([site.lat, site.lon], {
        radius: innerR, color, fillColor: color, fillOpacity: 0.18, weight: 0, interactive: false,
      }).addTo(group);

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
        </div>
      `;
      L.marker([site.lat, site.lon])
        .bindPopup(popupHtml, { className: 'map-site-marker-popup' })
        .addTo(group);
      bounds.push([site.lat, site.lon]);
    }

    if (bounds.length >= 1) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  }, [sites, forecasts]);

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Map</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Geographic view of every dive site on OpenStreetMap, with a P(no-go) heat-radius overlay.
        </p>
      </header>

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

      {/* Map frame */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MapIcon className="size-4 text-reef" />
              Live conditions
            </CardTitle>
            <LegendInline />
          </div>
        </CardHeader>
        <div
          ref={containerRef}
          className="h-[480px] w-full"
          data-testid="leaflet-map"
        />
      </Card>

      {/* Site list */}
      <section>
        <header className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Sites on this map</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Live P(no-go) per site · click a marker for details.
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
