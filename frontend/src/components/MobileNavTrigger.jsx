import { useSidebar } from '../theme/SidebarContext';
import { MenuIcon } from './icons';

/**
 * MobileNavTrigger — hamburger button. Visible only when the sidebar is
 * hidden (mobile mode: < 768px viewport). Tapping it calls
 * `toggleMobile()` which flips the body[data-sidebar-open] attribute
 * that the CSS drawer transition reads.
 *
 * Renders nothing in narrow/full modes (handled by CSS — `display: none`
 * when sidebar mode isn't mobile).
 */
export default function MobileNavTrigger() {
  const { mode, mobileOpen, toggleMobile } = useSidebar();
  if (mode !== 'mobile') return null;
  return (
    <button
      type="button"
      className="mobile-nav-trigger"
      onClick={toggleMobile}
      aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
      aria-expanded={mobileOpen}
      data-testid="mobile-nav-trigger"
    >
      <MenuIcon size={18} />
    </button>
  );
}
