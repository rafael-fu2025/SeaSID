import { useState, useEffect } from 'react';
import { api } from '../api';
import Dropdown from '../components/Dropdown';
import ForecastCard from '../components/ForecastCard';
import PBadChart from '../components/PBadChart';
import { RiskBadge } from '../components/RiskBadge';
import {
  SkeletonKpiStrip,
  SkeletonForecastGrid,
  SkeletonChart,
} from '../components/Skeleton';
import {
  GaugeIcon,
  RefreshIcon,
  AlertIcon,
} from '../components/icons';

const level = (p) => (p >= 0.6 ? 'high' : p >= 0.3 ? 'moderate' : 'low');

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtTimeFull(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function Dashboard() {
  const [sites, setSites] = useState([]);
  const [siteOptions, setSiteOptions] = useState([]);
  const [selectedSite, setSelectedSite] = useState('dauin_muck');
  const [forecast, setForecast] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.getSites()
      .then((s) => {
        setSites(s || []);
        setSiteOptions((s || []).map((site) => ({
          value: site.key,
          label: site.name,
          description: site.type,
        })));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);

    Promise.all([api.getForecast(selectedSite), api.getAlerts(selectedSite)])
      .then(([fc, al]) => {
        if (cancel) return;
        setForecast(fc);
        setAlerts(al.alerts || []);
      })
      .catch((err) => !cancel && setError(err.message))
      .finally(() => !cancel && setLoading(false));

    return () => { cancel = true; };
  }, [selectedSite]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [fc, al] = await Promise.all([
        api.getForecast(selectedSite),
        api.getAlerts(selectedSite),
      ]);
      setForecast(fc);
      setAlerts(al.alerts || []);
    } finally {
      setRefreshing(false);
    }
  };

  const currentHour = forecast?.hours?.[0];
  const next12 = forecast?.hours?.slice(0, 12) || [];
  const optimal = forecast?.optimal_window;
  const site = sites.find((s) => s.key === selectedSite);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Live dive-condition forecast for {forecast?.site_name ?? site?.name ?? '—'}
          </p>
        </div>
        <div className="flex gap-3" style={{ minWidth: 360 }}>
          {siteOptions.length > 0 && (
            <div style={{ flex: 1 }}>
              <Dropdown
                id="site-selector"
                ariaLabel="Select dive site"
                value={selectedSite}
                onChange={setSelectedSite}
                options={siteOptions}
                placeholder="Select site"
              />
            </div>
          )}
          <button className="btn btn--secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? <span className="spinner" /> : <RefreshIcon size={14} />}
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner--danger">
          <span className="banner__icon"><AlertIcon size={16} /></span>
          <div>
            <div className="banner__title">Could not load forecast</div>
            <div className="banner__body">
              {error}. Start the API with <code>python -m scripts.run_api</code> in the backend directory.
            </div>
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="banner">
          <span className="banner__icon"><AlertIcon size={16} /></span>
          <div>
            <div className="banner__title">
              {alerts.length} active alert{alerts.length === 1 ? '' : 's'}
            </div>
            <div className="banner__body">
              {alerts.slice(0, 3).map((a) => `[${a.kind}] ${a.message}`).join(' · ')}
              {alerts.length > 3 && ` · +${alerts.length - 3} more`}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <>
          <SkeletonKpiStrip />
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">12-hour forecast</h2>
            </div>
            <div className="section__body">
              <SkeletonForecastGrid />
            </div>
          </section>
          <SkeletonChart />
        </>
      ) : (
        <>
          {currentHour && (
            <section className="kpi-strip" aria-label="Current conditions">
              <div className="kpi">
                <span className="kpi__label">Visibility</span>
                <span className="kpi__value">{currentHour.viz_label}</span>
                <span className="kpi__sub">{fmtTime(currentHour.ts)} UTC</span>
              </div>
              <div className="kpi">
                <span className="kpi__label">Current risk</span>
                <span className="kpi__value">
                  <RiskBadge risk={currentHour.current_risk} />
                </span>
                <span className="kpi__sub">Surface current assessment</span>
              </div>
              <div className="kpi">
                <span className="kpi__label">P(no-go)</span>
                <span className={`kpi__value num kpi__value--${level(currentHour.p_bad)}`}>
                  {Math.round(currentHour.p_bad * 100)}%
                </span>
                <span className="kpi__sub">Threshold 60% / 30%</span>
              </div>
              <div className="kpi">
                <span className="kpi__label">Model in use</span>
                <span className="kpi__value" style={{ fontSize: 'var(--text-lg)' }}>
                  {currentHour.model_used}
                </span>
                <span className="kpi__sub">{forecast?.ml_bundle_loaded ? 'Bundle loaded' : 'Heuristic fallback'}</span>
              </div>
            </section>
          )}

          <section className="section" aria-labelledby="timeline-heading">
            <div className="section__head">
              <div>
                <h2 id="timeline-heading" className="section__title">12-hour forecast</h2>
                <p className="section__sub">Each hour is a single forecast card with risk badge and probability meter</p>
              </div>
            </div>
            <div className="section__body">
              <div className="forecast-grid" role="list">
                {next12.map((hour) => (
                  <ForecastCard key={hour.ts} hour={hour} />
                ))}
              </div>
            </div>
          </section>

          {optimal && <PBadChart hours={next12} optimalIso={optimal.ts} />}

          {optimal && (
            <section className="section">
              <div className="section__head">
                <div>
                  <h2 className="section__title">Optimal dive window</h2>
                  <p className="section__sub">The hour in the next 12 with the lowest no-go probability</p>
                </div>
              </div>
              <div className="section__body">
                <div className="grid-3">
                  <div>
                    <div className="card-label">When</div>
                    <div className="mono" style={{ fontSize: 'var(--text-xl)', marginTop: 4 }}>
                      {fmtTimeFull(optimal.ts)}
                    </div>
                  </div>
                  <div>
                    <div className="card-label">Visibility</div>
                    <div style={{ fontSize: 'var(--text-md)', marginTop: 6 }}>{optimal.viz_label}</div>
                  </div>
                  <div>
                    <div className="card-label">P(no-go)</div>
                    <div className="mono" style={{ fontSize: 'var(--text-xl)', marginTop: 4 }}>
                      {Math.round(optimal.p_bad * 100)}%
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {forecast && (
            <footer className="muted" style={{ fontSize: 'var(--text-xs)', textAlign: 'right', marginTop: 'var(--space-5)' }}>
              Generated {fmtTimeFull(forecast.generated_at)} · {site?.description ?? ''}
            </footer>
          )}
        </>
      )}
    </div>
  );
}
