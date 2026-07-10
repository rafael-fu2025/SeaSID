import { useSidebar } from '../theme/SidebarContext';
import { ChevronRightIcon } from './icons';

/**
 * CollapseFab — FAB-style seam control for the desktop sidebar.
 *
 *   - NOT a child of the sidebar (which would mean it scrolls with the
 *     rail and gets clipped by the rail's overflow rules).
 *   - NOT a child of the main column.
 *   - It lives in .app-layout, absolutely positioned against the layout
 *     container itself, hovering above the boundary where the sidebar
 *     meets the main content.
 *
 * The pill's horizontal position tracks --sidebar-current (set on
 * .app-layout by the existing collapsed/expanded media rules) so when
 * the sidebar animates 232 → 64 px, the pill slides along with it.
 *
 * Only renders on `mode === "full"` (≥ 1024 px). On md the rail is
 * already icon-only; on xs/sm the drawer + hamburger handle the
 * navigation.
 */
export default function CollapseFab() {
  const { mode, collapsed, toggleCollapse } = useSidebar();
  if (mode !== 'full') return null;
  return (
    <button
      type="button"
      className="collapse-fab"
      onClick={toggleCollapse}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-pressed={collapsed}
      data-testid="sidebar-collapse"
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <ChevronRightIcon size={12} />
    </button>
  );
}
