import { NavLink } from 'react-router-dom';
import {
  Gauge, Waves, Map, FlaskConical, ClipboardCheck,
  Settings2, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import UserMenu from '@/components/UserMenu';
import { useTheme } from '@/theme/ThemeContext';
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
 *     - A `PanelLeftClose` chevron at the bottom collapses the rail.
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

export function SidebarNav({
  collapsed = false,
  onToggle,
  hideCollapseChevron = false,
}) {
  const { theme } = useTheme();
  // Dark theme gets the lighter variants so the marks stay visible on the
  // dark cockpit surface; light theme keeps the original artwork.
  const brandSrc = collapsed
    ? (theme === 'dark' ? '/seasid_1x1-light.png' : '/seasid_1x1.png')
    : (theme === 'dark' ? '/seasid-light.png' : '/seasid.png');
  return (
    <aside
      aria-label="Primary navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex h-full w-full flex-col border-r border-border bg-card text-foreground transition-[width] duration-200"
    >
      {/* Brand — always visible at top. The collapse toggle rides along
          the brand row so it sits to the right of the wordmark when
          expanded and directly under the square mark when collapsed. */}
      <NavLink
        to="/"
        aria-label="SeaSID — go to Dashboard"
        data-testid="brand-link"
        className={cn(
          'flex shrink-0 items-center border-b border-border py-3',
          collapsed ? 'flex-col justify-center gap-2 px-2' : 'gap-2 px-3',
        )}
      >
        <img
          src={brandSrc}
          alt="SeaSID"
          width={36}
          height={36}
          className={cn(
            'shrink-0 rounded-md object-contain',
            // Use intrinsic sizing so the asset renders at its native
            // pixel size instead of relying on the browser to stretch
            // the lighter variants, which kept the marks inconsistent
            // between themes.
            collapsed ? 'size-9 h-9 w-9' : 'h-9 w-auto',
          )}
        />
        {!hideCollapseChevron && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            data-testid="nav-collapse"
            className={cn(
              'inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors',
              'hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              collapsed ? 'size-8' : 'ml-auto h-7 px-2',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-3.5" />
            ) : (
              <PanelLeftClose className="size-3.5" />
            )}
          </button>
        )}
      </NavLink>

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

      {/* Profile pinned to the bottom, isolated from the page modules. */}
      <div className="flex-1" />

      <div
        className={cn(
          'shrink-0 border-t border-border py-2',
          collapsed ? 'flex justify-center px-2' : 'px-3',
        )}
        data-testid="sidebar-user-menu-wrap"
      >
        <UserMenu variant={collapsed ? 'compact' : 'sidebar'} />
      </div>
    </aside>
  );
}
