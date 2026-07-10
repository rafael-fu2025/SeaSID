import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  GaugeIcon, WaveIcon, BrainIcon, ClipboardIcon, LabIcon,
  MapIcon, SettingsIcon, ChevronRightIcon, XIcon,
} from './icons';
import { useSidebar } from '../theme/SidebarContext';

/**
 * Sidebar — single visual component, mode-aware (drawer/narrow/full).
 *
 *  - On 'drawer' mode (xs / sm): hidden by default. Slides in from
 *    the left when `mobileOpen` is true. Parent renders a backdrop
 *    that intercepts clicks outside the panel.
 *  - On 'narrow' mode (md): persistent 64 px rail. No chevron, no
 *    labels — taps land on tooltipped icons.
 *  - On 'full' mode (lg / xl): persistent 232 px sidebar with text
 *    labels. The chevron pill collapses it to a 64 px rail.
 *
 *  The body attributes (`data-sidebar-mode`, `data-sidebar-collapsed`,
 *  `data-sidebar-open`) drive every CSS rule for the sidebar so this
 *  component can be a pure JSX tree with no inline layout decisions.
 */

const NAV = [
  { to: '/',           label: 'Dashboard',  Icon: GaugeIcon },
  { to: '/forecast',   label: 'Forecast',   Icon: WaveIcon },
  { to: '/map',        label: 'Map',        Icon: MapIcon },
  { to: '/experiments',label: 'Experiments',Icon: LabIcon },
  { to: '/verify',     label: 'Verify',     Icon: ClipboardIcon },
  { to: '/settings',   label: 'Settings',   Icon: SettingsIcon },
];

const SITES = [
  { key: 'dauin_muck', name: 'Dauin Muck', type: 'muck' },
  { key: 'apo_reef',   name: 'Apo Reef',   type: 'reef' },
];

const linkClass = ({ isActive }) =>
  ['sidebar__link', isActive ? 'is-active' : ''].filter(Boolean).join(' ');

export default function Sidebar() {
  const { mode, collapsed, toggleCollapse, closeMobile } = useSidebar();
  const location = useLocation();

  // Close the drawer whenever the route changes (so tapping a nav item
  // dismisses the panel immediately).
  useEffect(() => {
    if (mode === 'drawer') closeMobile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Esc closes the drawer when open.
  useEffect(() => {
    if (mode !== 'drawer') return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeMobile();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, closeMobile]);

  return (
    <>
      {/* Backdrop only on mobile/tablet, only when the drawer is open. */}
      {mode === 'drawer' && (
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
        aria-label="Primary"
      >
        {mode === 'full' && (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={toggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            data-testid="sidebar-collapse"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronRightIcon size={12} />
          </button>
        )}

        {mode === 'drawer' && (
          <button
            type="button"
            className="sidebar__close"
            onClick={closeMobile}
            aria-label="Close navigation"
            data-testid="sidebar-close"
          >
            <XIcon size={16} />
          </button>
        )}

        <div className="sidebar__brand">
          <div className="sidebar__brand-mark" aria-hidden>
            <WaveIcon size={16} />
          </div>
          <div className="sidebar__brand-text">
            <div className="sidebar__brand-name">SeaSID</div>
            <div className="sidebar__brand-sub">Dumaguete · v2.0</div>
          </div>
        </div>

        <nav className="sidebar__section" aria-label="Main">
          <div className="sidebar__section-label">Main</div>
          <ul className="sidebar__nav">
            {NAV.map((item) => {
              const Icon = item.Icon;
              const collapsedView = mode === 'full' && collapsed;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={linkClass}
                    title={collapsedView || mode === 'narrow' ? item.label : undefined}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <nav className="sidebar__section" aria-label="Sites">
          <div className="sidebar__section-label">Sites</div>
          <ul className="sidebar__nav">
            {SITES.map((site) => (
              <li key={site.key}>
                <span
                  className="sidebar__link"
                  style={{ cursor: 'default' }}
                  title={mode === 'narrow' || (mode === 'full' && collapsed) ? site.name : undefined}
                >
                  <span>{site.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__footer-row">
            <span>Region</span>
            <strong>Dumaguete, PH</strong>
          </div>
          <div className="sidebar__footer-row">
            <span>Build</span>
            <strong className="mono">2.0.0</strong>
          </div>
        </div>
      </aside>
    </>
  );
}
