import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useTheme } from '../theme/ThemeContext';
import { AGENT_TOOLS } from '../agent/registry';
import Dropdown from '../components/Dropdown';
import { SunIcon, MoonIcon, CheckIcon, InfoIcon, LabIcon } from '../components/icons';

const SITE_OPTIONS_CACHE = { current: null };

async function fetchSites() {
  if (!SITE_OPTIONS_CACHE.current) {
    SITE_OPTIONS_CACHE.current = (await api.getSites()).map((s) => ({
      value: s.key,
      label: s.name,
      description: s.type,
    }));
  }
  return SITE_OPTIONS_CACHE.current;
}

const DEFAULT_SITE_KEY = 'seasid.defaultSite';
const TOOLS_ENABLED_KEY = 'seasid.toolsEnabled';

function readJSON(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

function writeJSON(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function readString(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function writeString(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

/**
 * Settings — page-level controls for theme + default site + agent tooling.
 *
 * Sections:
 *   1. Appearance — theme toggle (Light / Dark)
 *   2. Agent — default site, per-tool enable/disable
 *   3. Tools — full table of agent tools with params + descriptions
 *
 * Defaults are computed as follows:
 *   - theme = "dark" (locked-in from SeaSID.md; users can override)
 *   - default site = "dauin_muck"
 *   - all tools enabled
 */
export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [sites, setSites] = useState([]);
  const [defaultSite, setDefaultSite] = useState(() => readString(DEFAULT_SITE_KEY, 'dauin_muck'));
  const [toolsEnabled, setToolsEnabled] = useState(() => readJSON(TOOLS_ENABLED_KEY, {}));

  useEffect(() => {
    fetchSites().then(setSites).catch(() => setSites([]));
  }, []);

  useEffect(() => { writeString(DEFAULT_SITE_KEY, defaultSite); }, [defaultSite]);
  useEffect(() => { writeJSON(TOOLS_ENABLED_KEY, toolsEnabled); }, [toolsEnabled]);

  const siteOptions = useMemo(() => sites.length > 0 ? sites : [
    { value: 'dauin_muck', label: 'Dauin Muck Bays', description: 'muck' },
    { value: 'apo_reef',   label: 'Apo Island Reef', description: 'reef' },
  ], [sites]);

  const toggleTool = (name, enabled) => {
    setToolsEnabled((prev) => ({ ...prev, [name]: enabled }));
  };

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Personalize the dashboard, change the default site, and inspect every agent tool
          </p>
        </div>
      </header>

      {/* ── 0. Data sources (live) ────────────────────────────────────────── */}
      <ProviderStatus />

      {/* ── 1. Appearance ───────────────────────────────────────────────── */}
      <section className="section" data-testid="settings-appearance">
        <div className="section__head">
          <h2 className="section__title">Appearance</h2>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Stored in <code>localStorage</code> under <code>seasid.theme</code>
          </span>
        </div>
        <div className="section__body">
          <div className="setting-row">
            <div className="setting-row__label">
              <div className="setting-row__label-name">Theme</div>
              <div className="setting-row__label-desc">
                Pick the color scheme used across the dashboard. The default is <strong>dark</strong>; switch whenever you need
                more brightness.
              </div>
            </div>
            <div className="setting-row__control">
              <div className="theme-switch" role="tablist" aria-label="Color theme">
                <button
                  type="button"
                  className={`theme-switch__btn ${theme === 'light' ? 'is-active' : ''}`}
                  onClick={() => setTheme('light')}
                  role="tab"
                  aria-selected={theme === 'light'}
                  data-testid="theme-light"
                >
                  <SunIcon size={14} />
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  className={`theme-switch__btn ${theme === 'dark' ? 'is-active' : ''}`}
                  onClick={() => setTheme('dark')}
                  role="tab"
                  aria-selected={theme === 'dark'}
                  data-testid="theme-dark"
                >
                  <MoonIcon size={14} />
                  <span>Dark</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Agent ───────────────────────────────────────────────────── */}
      <section className="section" data-testid="settings-agent">
        <div className="section__head">
          <h2 className="section__title">Agent</h2>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>Default site & per-tool toggles</span>
        </div>
        <div className="section__body">
          <div className="setting-row">
            <div className="setting-row__label">
              <div className="setting-row__label-name">Default site</div>
              <div className="setting-row__label-desc">
                Pre-selected site when opening the agent or any forecast panel.
              </div>
            </div>
            <div className="setting-row__control" style={{ minWidth: 220 }}>
              <Dropdown
                value={defaultSite}
                onChange={setDefaultSite}
                options={siteOptions}
                ariaLabel="Default site"
                placeholder="Select site"
                id="default-site"
              />
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-row__label">
              <div className="setting-row__label-name">Tools</div>
              <div className="setting-row__label-desc">
                Toggle off any tool the agent should never call. Disabled tools remain listed below for reference but are omitted
                from the model's tool_choice list.
              </div>
            </div>
            <div className="setting-row__control" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {AGENT_TOOLS.map((t) => {
                const isOn = toolsEnabled[t.name] !== false;
                return (
                  <label key={t.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOn}
                      onClick={() => toggleTool(t.name, !isOn)}
                      className={`toggle ${isOn ? 'is-on' : ''}`}
                      data-testid={`tool-toggle-${t.name}`}
                    />
                    <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{t.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Tools reference ────────────────────────────────────────── */}
      <section className="section" data-testid="settings-tools">
        <div className="section__head">
          <h2 className="section__title">Agent tools</h2>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Synced from <code>backend/app/lib/agent_tools.py</code>
          </span>
        </div>
        <div className="section__body section__body--flush">
          <div className="table-wrap">
            <table className="table" data-testid="tools-table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Tool</th>
                  <th>Description</th>
                  <th style={{ width: '32%' }}>Parameters</th>
                </tr>
              </thead>
              <tbody>
                {AGENT_TOOLS.map((tool) => (
                  <tr key={tool.name}>
                    <td className="label-cell">
                      <code className="mono" style={{ fontSize: 'var(--text-sm)' }}>{tool.name}</code>
                    </td>
                    <td>{tool.description}</td>
                    <td>
                      {tool.params.length === 0 ? (
                        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>none</span>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {tool.params.map((p) => (
                            <li key={p.name}>
                              <code className="tool-schema">{p.name}</code>
                              <span style={{ marginLeft: 6, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                {p.type}{p.required ? ' · required' : ''}
                              </span>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                                {p.description}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="banner banner--info">
        <span className="banner__icon"><InfoIcon size={16} /></span>
        <div>
          <div className="banner__title">About settings</div>
          <div className="banner__body">
            These preferences live in your browser only. There is no server-side user profile in v1.
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ProviderStatus — small section that shows which third-party data
 * providers are currently active in the backend, surfaced through
 * /api/v1/health. Operators rely on this to confirm that AQICN_API_KEY
 * and STORMGLASS_API_KEY are wired up correctly.
 *
 * "Weather" and "Marine" are always populated (Open-Meteo defaults).
 * "Air" only appears when SEASID_PROVIDER_AIR is set to a real provider
 * — usually `aqicn`.
 */
function ProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    api.health()
      .then((h) => { if (!cancel) { setProviders(h.providers || {}); setLoaded(true); } })
      .catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);

  const ROLES = [
    { role: 'weather', label: 'Weather',  defaultName: 'open_meteo' },
    { role: 'marine',  label: 'Marine',   defaultName: 'open_meteo' },
    { role: 'air',     label: 'Air',      defaultName: 'off' },
  ];

  return (
    <section className="section" data-testid="settings-providers">
      <div className="section__head">
        <h2 className="section__title">Data sources</h2>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          Live providers reported by <code>/api/v1/health</code>
        </span>
      </div>
      <div className="section__body">
        {!loaded ? (
          <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>Loading…</div>
        ) : (
          <div className="map-site-list">
            {ROLES.map(({ role, label, defaultName }) => {
              const name = providers?.[role] ?? defaultName;
              const isDefault = name === defaultName;
              const isOptional = role === 'air' && name === 'off';
              return (
                <div className="map-site-card" key={role}>
                  <div className="map-site-card__name">{label}</div>
                  <div className="map-site-card__coords">{name}</div>
                  <div
                    className="muted"
                    style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}
                    data-testid={`provider-status-${role}`}
                  >
                    {isOptional
                      ? 'Not configured — set AQICN_API_KEY to enable.'
                      : isDefault
                        ? 'Default provider, no key required.'
                        : 'Custom provider active.'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
