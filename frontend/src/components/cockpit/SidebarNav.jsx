import { NavLink, useLocation } from 'react-router-dom';
import {
  Gauge, Waves, Map, FlaskConical, ClipboardCheck,
  Settings2, WavesIcon,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * SidebarNav — left rail of the SeaSID cockpit.
 *
 *  - Vertical icon rail, fixed width (managed by the parent PanelGroup).
 *  - NavLink active styling comes from react-router; we add visual
 *    reinforcement with a "is-active" className so the active page
 *    has a left accent bar.
 *  - Sites are static (Dauin Muck / Apo Reef) for v3 but live behind
 *    a section header so future sites are just a list push.
 *
 * No collapse toggle — the cockpit shell is always-visible by design.
 * Resizing is handled by drag on the parent `ResizableHandle`.
 */
const NAV = [
  { to: '/',            label: 'Dashboard',   Icon: Gauge },
  { to: '/forecast',    label: 'Forecast',    Icon: Waves },
  { to: '/map',         label: 'Map',         Icon: Map },
  { to: '/experiments', label: 'Experiments', Icon: FlaskConical },
  { to: '/verify',      label: 'Verify',      Icon: ClipboardCheck },
  { to: '/settings',    label: 'Settings',    Icon: Settings2 },
];

const SITES = [
  { key: 'dauin_muck', name: 'Dauin Muck', type: 'muck' },
  { key: 'apo_reef',   name: 'Apo Reef',   type: 'reef' },
];

function linkClass({ isActive }) {
  return cn(
    'group relative flex h-10 w-10 items-center justify-center rounded-md',
    'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    isActive && 'bg-muted text-reef',
  );
}

function SiteDot({ type }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 rounded-full',
        type === 'reef' ? 'bg-reef' : 'bg-positive',
      )}
    />
  );
}

export function SidebarNav() {
  const location = useLocation();

  return (
    <aside
      aria-label="Primary navigation"
      className="flex h-full w-full flex-col border-r border-border bg-card text-foreground"
    >
      {/* Brand */}
      <div className="flex items-center justify-center border-b border-border px-2 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex size-9 items-center justify-center rounded-md bg-reef text-reef-foreground shadow-sm"
              aria-label="SeaSID"
            >
              <WavesIcon className="size-5" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span className="font-semibold">SeaSID</span>
            <span className="ml-1 text-xs text-muted-foreground">v3.0</span>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Page nav */}
      <nav aria-label="Pages" className="flex flex-col items-center gap-1 px-2 py-3">
        <span className="sr-only">Pages</span>
        {NAV.map(({ to, label, Icon }) => (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                end={to === '/'}
                className={linkClass}
                aria-label={label}
                data-testid={`nav-${label.toLowerCase()}`}
              >
                <Icon className="size-4" />
                {/* Accent bar for active state */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-0 top-1.5 h-7 w-0.5 rounded-r-full bg-reef transition-opacity',
                    location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-50',
                  )}
                />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">
              {label}
              {label === 'Dashboard' && (
                <span className="ml-1 text-xs text-muted-foreground">⌘1</span>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-2 my-2 h-px bg-border" aria-hidden />

      {/* Site list */}
      <div className="flex flex-col items-center gap-1 px-2">
        <span className="sr-only">Sites</span>
        {SITES.map((site) => (
          <Tooltip key={site.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={site.name}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <SiteDot type={site.type} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {site.name}
              <span className="ml-1 text-xs uppercase tracking-wide text-muted-foreground">
                {site.type}
              </span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Bottom spacer */}
      <div className="flex-1" />

      {/* Footer micro-meta */}
      <div className="flex items-center justify-center border-t border-border px-2 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-2 rounded-full bg-positive shadow-[0_0_0_3px_rgba(108,202,143,0.18)]" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">API online</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
