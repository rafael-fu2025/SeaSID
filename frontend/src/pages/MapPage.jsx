import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import { RiskBadge } from '../components/RiskBadge';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { MapIcon } from '../components/icons';

/**
 * MapPage — OpenStreetMap view with site markers and a P(no-go) heat-radius
 * around each. Uses Leaflet directly (no extra wrapper lib) so the JS cost
 * is minimal.
 *
 * Tile server: OpenStreetMap (no API key required). Attribution is preserved.
 *
 * The "heatmap" is rendered as concentric circles drawn with leaflet's
 * SVG layer — colour and radius encode the per-site P(no-go) so the user
 * can see at a glance which sites are running hot.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap contributors';

const RISK_COLOR = {
  low: '#22c55e',
  moderate: '#e0a062',
  high: '#e07279',
  unknown: '#94a3b8',
};

function riskLevel(p) {
  if (p == null) return 'unknown';
  if (p >= 0.6) return 'high';
  if (p >= 0.3) return 'moderate';
  return 'low';
}

function fmt(n, digits = 4) {
  return Number(n).toFixed(digits);
}

export default function MapPage() {
  const mapRef = useRef(null);
  const leafletContainerRef = useRef(null);
  const layerGroupRef = useRef(null);

  const [sites, setSites] = useState([]);
  const [forecasts, setForecasts] = useState({}); // {site_key: forecast}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pull sites + their forecasts in parallel so we have something to render.
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
            api.getForecast(site.key).then((fc) => [site.key, fc]).catch((e) => [site.key, null])
          )
        );
        if (cancel) return;
        const map = {};
        for (const p of pairs) {
          if (p.status === 'fulfilled') map[p.value[0]] = p.value[1];
        }
        setForecasts(map);
      })
      .catch((err) => { if (!cancel) setError(err.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  // Build the Leaflet map exactly once.
  useEffect(() => {
    if (mapRef.current || !leafletContainerRef.current) return;
    const map = L.map(leafletContainerRef.current, {
      center: [9.12, 123.27],   // between the two anchor sites
      zoom: 11,
      scrollWheelZoom: true,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // (Re)draw markers and heat circles whenever the data changes.
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

      // Heat radius — bigger for higher P(no-go), plus a softer outer halo.
      const innerR = p == null ? 0 : 220 + p * 1200;
      const outerR = innerR + 350;

      L.circle([site.lat, site.lon], {
        radius: outerR,
        color,
        fillColor: color,
        fillOpacity: 0.10,
        weight: 0,
        interactive: false,
      }).addTo(group);

      L.circle([site.lat, site.lon], {
        radius: innerR,
        color,
        fillColor: color,
        fillOpacity: 0.18,
        weight: 0,
        interactive: false,
      }).addTo(group);

      const marker = L.marker([site.lat, site.lon]);
      const air = fc?.air;
      const airLine = air?.available
        ? `<div class="map-popup__row"><span>Air (AQI)</span><strong>${Math.round(air.aqi)} · ${escapeHtml(air.station_name ?? '—')}</strong></div>`
        : '';
      const popupHtml = `
        <div class="map-popup">
          <p class="map-popup__title">${escapeHtml(site.name)}</p>
          <div class="map-popup__row"><span>Type</span><strong>${escapeHtml(site.type)}</strong></div>
          <div class="map-popup__row"><span>P(no-go)</span><strong>${p == null ? '—' : Math.round(p * 100) + '%'}</strong></div>
          <div class="map-popup__row"><span>Visibility</span><strong>${escapeHtml(cur?.viz_label ?? '—')}</strong></div>
          <div class="map-popup__row"><span>Current</span><strong>${escapeHtml(cur?.current_risk ?? '—')}</strong></div>
          ${airLine}
          <div class="map-popup__row"><span>Coords</span><strong>${fmt(site.lat)}, ${fmt(site.lon)}</strong></div>
        </div>
      `;
      marker.bindPopup(popupHtml, { className: 'map-site-marker-popup' }).addTo(group);
      bounds.push([site.lat, site.lon]);
    }

    if (bounds.length >= 1) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
    }
  }, [sites, forecasts]);

  const tiles = useMemo(
    () =>
      sites.map((site) => {
        const fc = forecasts[site.key];
        const cur = fc?.hours?.[0];
        const p = cur?.p_bad ?? null;
        const level = riskLevel(p);
        const air = fc?.air;
        const aqiLevel = air?.available
          ? (air.aqi >= 150 ? 'high' : air.aqi >= 100 ? 'moderate' : 'low')
          : 'unknown';
        return (
          <article className="map-site-card" key={site.key}>
            <div className="map-site-card__name">{site.name}</div>
            <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{site.description}</div>
            <div className="map-site-card__coords">
              {fmt(site.lat)} · {fmt(site.lon)} · {site.type}
            </div>
            <div className="map-site-card__meta">
              <div>
                <div className="card-label">P(no-go)</div>
                <span className={`map-site-card__p map-site-card__p--${level}`}>
                  {p == null ? '—' : Math.round(p * 100) + '%'}
                </span>
              </div>
              <RiskBadge risk={cur?.overall_risk || cur?.risk || 'unknown'} label={cur?.overall_risk || cur?.risk} />
            </div>
            {air?.available ? (
              <div className="map-site-card__meta" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 4 }} data-testid={`map-air-${site.key}`}>
                <div>
                  <div className="card-label">Air (AQI)</div>
                  <span className={`map-site-card__p map-site-card__p--${aqiLevel}`}>
                    {Math.round(air.aqi)}
                  </span>
                </div>
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>{air.station_name ?? '—'}</span>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
                Air quality: not configured
              </div>
            )}
          </article>
        );
      }),
    [sites, forecasts]
  );

  return (
    <div className="map-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Map</h1>
          <p className="page-subtitle">
            Geographic view of every dive site on OpenStreetMap, with a P(no-go) heat-radius overlay
          </p>
        </div>
      </header>

      {error && (
        <div className="banner banner--danger" style={{ marginBottom: 'var(--space-5)' }}>
          <span className="banner__icon"><MapIcon size={16} /></span>
          <div>
            <div className="banner__title">Could not load sites</div>
            <div className="banner__body">{error}</div>
          </div>
        </div>
      )}

      <section className="map-frame">
        <div className="map-frame__legend">
          <div className="map-frame__legend-item">
            <span className="map-frame__legend-dot map-frame__legend-dot--low" /> Low risk (P &lt; 30%)
          </div>
          <div className="map-frame__legend-item">
            <span className="map-frame__legend-dot map-frame__legend-dot--moderate" /> Moderate (30–60%)
          </div>
          <div className="map-frame__legend-item">
            <span className="map-frame__legend-dot map-frame__legend-dot--high" /> High risk (&ge; 60%)
          </div>
          <div className="map-frame__legend-item muted">
            Heat-radius scale: harder red on riskier sites
          </div>
        </div>

        <div ref={leafletContainerRef} className="map-frame__map" data-testid="leaflet-map" />
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Sites on this map</h2>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Live P(no-go) per site · click a marker for details
          </span>
        </div>
        <div className="section__body">
          {loading ? (
            <div className="map-site-list" data-testid="map-skeleton-list">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i}>
                  <Skeleton style={{ height: 8, marginBottom: 8 }} />
                  <Skeleton style={{ height: 12, marginBottom: 8 }} />
                  <Skeleton style={{ height: 8, marginBottom: 8 }} />
                  <Skeleton style={{ height: 28 }} />
                </div>
              ))}
            </div>
          ) : sites.length === 0 ? (
            <div className="empty">
              <div className="empty__title">No sites registered</div>
            </div>
          ) : (
            <div className="map-site-list" data-testid="map-site-list">
              {tiles}
            </div>
          )}
        </div>
      </section>
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
