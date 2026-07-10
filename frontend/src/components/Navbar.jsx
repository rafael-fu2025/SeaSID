import { NavLink } from 'react-router-dom';
import {
  GaugeIcon,
  WaveIcon,
  BrainIcon,
  ClipboardIcon,
  LabIcon,
} from './icons';

const NAV = [
  { to: '/', label: 'Dashboard', icon: GaugeIcon, end: true },
  { to: '/forecast', label: 'Forecast', icon: WaveIcon },
  { to: '/agent', label: 'AI Agent', icon: BrainIcon },
  { to: '/experiments', label: 'Experiments', icon: LabIcon },
  { to: '/verify', label: 'Verify', icon: ClipboardIcon },
];

const linkClass = ({ isActive }) =>
  ['sidebar__link', isActive ? 'is-active' : ''].filter(Boolean).join(' ');

export default function Navbar() {
  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="sidebar__brand">
        <div className="sidebar__brand-mark" aria-hidden>
          <WaveIcon size={16} />
        </div>
        <div>
          <div className="sidebar__brand-name">SeaSID</div>
          <div className="sidebar__brand-sub">v2.0</div>
        </div>
      </div>

      <div className="sidebar__section">
        <ul className="sidebar__nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={linkClass}>
                  <Icon size={15} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sidebar__section">
        <div className="sidebar__section-label">Sites</div>
        <ul className="sidebar__nav">
          <li>
            <span className="sidebar__link" style={{ cursor: 'default' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--positive)' }} />
              <span>Dauin Muck</span>
            </span>
          </li>
          <li>
            <span className="sidebar__link" style={{ cursor: 'default' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              <span>Apo Reef</span>
            </span>
          </li>
        </ul>
      </div>

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
  );
}
