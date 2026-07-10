import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  GaugeIcon, WaveIcon, MapIcon, LabIcon, ClipboardIcon,
  SettingsIcon, ChevronLeftIcon,
} from './icons';
import { useSidebar } from '../theme/SidebarContext';

/**
 * Sidebar — single, clean column. Designed to match the professional
 * pattern used by Linear / Notion / Stripe:
 *
 *   ┌────────────────┐
 *   │  BRAND          │   ← sticky top, never collapses
 *   ├────────────────┤
 *   │  Main          │   ← scrollable middle
 *   │   • Dashboard  │
 *   │   • Forecast   │
 *   │   • Map        │
 *   │   • …          │
 *   ├────────────────┤
 *   │  Sites         │
 *   │   • Dauin      │
 *   │   • Apo        │
 *   ├────────────────┤
 *   │  Region · ver  │   ← sticky footer, never scrolls out
 *   │  [ ⊟ collapse ]│   ← THE collapse button. Bottom-right of the
 *   └────────────────┘      footer. Stays inside the sidebar in both
 *                            states. The chevron rotates 180° when
 *                            collapsed to hint "expand".
 *
 * On mobile (< 768 px) the entire aside is rendered as a fixed drawer
 * overlay, hidden off-canvas by default. <MobileNavTrigger /> toggles
 * the open state; a backdrop intercepts outside clicks.
 *
 * On desktop (≥ 768 px) the aside is a permanent flex item in the
 * shell. The collapse button at the bottom switches between 232 px and
 * 64 px wide. Collapsed state persists in localStorage.
 */

const NAV = [
  { to: '/',           label: 'Dashboard',   Icon: GaugeIcon },
  { to: '/forecast',   label: 'Forecast',    Icon: WaveIcon },
  { to: '/map',        label: 'Map',         Icon: MapIcon },
  { to: '/experiments',label: 'Experiments', Icon: LabIcon },
  { to: '/verify',     label: 'Verify',      Icon: ClipboardIcon },
  { to: '/settings',   label: 'Settings',    Icon: SettingsIcon },
];

const SITES = [
  { key: 'dauin_muck', name: 'Dauin Muck', type: 'muck' },
  { key: 'apo_reef',   name: 'Apo Reef',   type: 'reef' },
];

const linkClass = ({ isActive }) =>
  ['sidebar__link', isActive ? 'is-active' : ''].filter(Boolean).join(' ');

function SiteDot({ type }) {
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: type === 'reef' ? 'var(--accent)' : 'var(--positive)',
        flexShrink: 0,
      }}
    />
  );
}

export default function Sidebar() {
  const { mode, collapsed, open, toggleCollapse, closeMobile } = useSidebar();
  const location = useLocation();

  // Auto-close the mobile drawer on route change so the panel
  // dismisses immediately when the user taps a link.
  useEffect(() => {
    if (mode === 'mobile' && open) closeMobile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {/* Backdrop — only on mobile when the drawer is open. */}
      {mode === 'mobile' && open && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={closeMobile}
          aria-label="Close navigation"
          tabIndex={-1}
        />
      )}

      <aside
        className="sidebar"
        data-mode={mode}
        data-collapsed={collapsed ? 'true' : 'false'}
        data-open={open ? 'true' : 'false'}
        aria-label="Primary"
      >
        {/* ── Brand (sticky top) ─────────────────────────────────────── */}
        <div className="sidebar__brand">
          <div className="sidebar__brand-mark" aria-hidden>
            <WaveIcon size={16} />
          </div>
          <div className="sidebar__brand-text">
            <div className="sidebar__brand-name">SeaSID</div>
            <div className="sidebar__brand-sub">Dumaguete · v2.1</div>
          </div>
        </div>

        {/* ── Nav (scrolls in the middle) ────────────────────────────── */}
        <nav className="sidebar__nav-region" aria-label="Main">
          <div className="sidebar__section-label">Main</div>
          <ul className="sidebar__nav">
            {NAV.map((item) => {
              const Icon = item.Icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={linkClass}
                    title={mode === 'mobile' ? item.label : undefined}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>

          <div className="sidebar__section-label" style={{ marginTop: 'var(--space-4)' }}>Sites</div>
          <ul className="sidebar__nav">
            {SITES.map((site) => (
              <li key={site.key}>
                <span
                  className="sidebar__link"
                  style={{ cursor: 'default' }}
                  title={mode === 'mobile' ? site.name : undefined}
                >
                  <SiteDot type={site.type} />
                  <span>{site.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </nav>

        {/* ── Footer (sticky bottom) — contains the collapse toggle ─ */}
        <div className="sidebar__footer">
          <div className="sidebar__footer-meta">
            <div className="sidebar__footer-row">
              <span>Region</span>
              <strong>Dumaguete, PH</strong>
            </div>
            <div className="sidebar__footer-row">
              <span>Build</span>
              <strong className="mono">2.1.0</strong>
            </div>
          </div>

          {/* THE collapse toggle — bottom-right of the footer.
              Lives INSIDE the sidebar on purpose so it scrolls /
              sizes with the rail naturally. The chevron rotates 180°
              when collapsed so the icon also doubles as the "expand"
              affordance — no separate buttons. */}
          {mode === 'desktop' && (
            <button
              type="button"
              className="sidebar__collapse"
              onClick={toggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              data-testid="sidebar-collapse"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronLeftIcon size={14} />
              <span className="sidebar__collapse-label">
                {collapsed ? 'Expand' : 'Collapse'}
              </span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
