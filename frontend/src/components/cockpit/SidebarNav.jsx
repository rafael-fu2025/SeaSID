import { NavLink } from 'react-router-dom';
import {
  Gauge, Waves, Map, FlaskConical, ClipboardCheck,
  Settings2, Waves as WavesIcon, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import UserMenu from '@/components/UserMenu';
import { cn } from '@/lib/utils';

/**
 * SidebarNav — left rail of the SeaSID cockpit.
 *
 * Two-mode design:
 *
 *   collapsed  (default 64 px)
 *     - Brand chip stays visible so the user can always find the
 *       collapse handle.
 *     - Each nav entry is icon-only; tooltip on hover for the label.
 *     - A `PanelLeftOpen` chevron at the bottom expands the rail.
 *
 *   expanded   (default 240 px)
 *     - Icons gain visible labels on the right.
 *     - Site list shows full site name + type tag.
 *     - A `PanelLeftClose` chevron at the bottom collapses the rail.
 *     - A small "Reset" link appears in the footer to wipe persisted
 *       layout state when the user can't recover.
 *
 * Widths are owner-controlled by the parent Layout via ResizablePanel's
 * `collapsedSize` / `minSize` props; this component just renders the
 * current mode and surfaces a way to toggle.
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

export function SidebarNav({
  collapsed = false,
  onToggle,
  onResetLayout,
  hideCollapseChevron = false,
}) {
  return (
    <aside
      aria-label="Primary navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex h-full w-full flex-col border-r border-border bg-card text-foreground transition-[width] duration-200"
    >
      {/* Brand — always visible at top */}
      <NavLink
        to="/"
        aria-label="SeaSID — go to Dashboard"
        data-testid="brand-link"
        className={cn(
          'flex shrink-0 items-center border-b border-border py-3',
          collapsed ? 'justify-center px-2' : 'gap-2 px-3',
        )}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-reef text-reef-foreground shadow-sm">
          <WavesIcon className="size-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">SeaSID</div>
            <div className="truncate text-[11px] text-muted-foreground">Team Shift v2</div>
          </div>
        )}
      </NavLink>

      {/* User menu — always visible. Clicking opens the account dropdown
          downward into the nav area (safe space, never clipped). */}
      <div
        className={cn(
          'shrink-0 border-b border-border py-2',
          collapsed ? 'px-2' : 'px-3',
        )}
        data-testid="sidebar-user-menu-wrap"
      >
        <UserMenu />
      </div>

      {/* Pages */}
      <nav
        aria-label="Pages"
        className={cn('flex flex-col gap-1 py-3', collapsed ? 'items-center px-2' : 'px-2')}
      >
        {NAV.map(({ to, label, Icon }) => {
          const linkEl = (
            <NavLink
              to={to}
              end={to === '/'}
              aria-label={collapsed ? label : undefined}
              data-testid={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-10 items-center rounded-none transition-colors',
                  collapsed ? 'w-10 justify-center' : 'w-full gap-3 px-3',
                  'text-muted-foreground hover:bg-muted hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive && 'bg-muted text-reef',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && (
                    <span className="truncate text-sm">{label}</span>
                  )}
                  {!collapsed && isActive && (
                    <span aria-hidden className="ml-auto size-1.5 rounded-full bg-reef" />
                  )}
                </>
              )}
            </NavLink>
          );
          if (collapsed) {
            return (
              <Tooltip key={to}>
                <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          }
          return <div key={to}>{linkEl}</div>;
        })}
      </nav>

      {/* Divider */}
      <div className={cn('h-px shrink-0 bg-border', collapsed ? 'mx-2' : 'mx-3')} aria-hidden />

      {/* Sites */}
      <div
        aria-label="Sites"
        className={cn('flex flex-col gap-1 py-3', collapsed ? 'items-center px-2' : 'px-2')}
      >
        {SITES.map((site) => {
          const dot = (
            <span
              aria-hidden
              className={cn(
                'inline-block size-1.5 shrink-0 rounded-full',
                site.type === 'reef' ? 'bg-reef' : 'bg-positive',
              )}
            />
          );
          if (collapsed) {
            return (
              <Tooltip key={site.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={site.name}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-none text-muted-foreground',
                      'transition-colors hover:bg-muted hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    {dot}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {site.name}
                  <span className="ml-1 text-xs uppercase tracking-wider text-muted-foreground">
                    {site.type}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          }
          return (
            <button
              key={site.key}
              type="button"
              data-testid={`site-link-${site.key}`}
              className="flex h-10 w-full items-center gap-3 rounded-none px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {dot}
              <span className="truncate text-sm">{site.name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                {site.type}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* Footer — collapse toggle + API pulse (+ Reset link when expanded) */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-t border-border',
          collapsed ? 'flex-col justify-center px-2 py-2' : 'px-3 py-2',
        )}
      >
        {!hideCollapseChevron && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggle}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-pressed={collapsed}
                data-testid="nav-collapse"
              className={cn(
                'inline-flex items-center justify-center rounded-none text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                collapsed ? 'size-8' : 'h-7 px-2',
              )}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-3.5" />
                ) : (
                  <>
                    <PanelLeftClose className="size-3.5" />
                    <span className="ml-1.5 text-xs">Collapse</span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? 'right' : 'top'}>
              {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden
              className="inline-flex size-2 rounded-full bg-positive shadow-[0_0_0_4px_rgba(108,202,143,0.18)]"
              data-testid="nav-api-pulse"
            />
          </TooltipTrigger>
          <TooltipContent side={collapsed ? 'right' : 'top'}>API online</TooltipContent>
        </Tooltip>

        {!collapsed && onResetLayout && (
          <button
            type="button"
            onClick={onResetLayout}
            aria-label="Reset cockpit layout to defaults"
            className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>
    </aside>
  );
}
