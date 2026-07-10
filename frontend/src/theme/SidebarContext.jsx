import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * SidebarContext — owns all sidebar state across breakpoints.
 *
 * Architecture: only TWO shapes the sidebar can take.
 *
 *   mode="desktop"  (>= 768 px viewport)
 *     - Sidebar is persistent in the .app-layout flex row.
 *     - Always visible at 232 px wide (expanded) or 64 px wide (collapsed).
 *     - User can toggle collapsed via the button at the BOTTOM of the
 *       sidebar footer — the conventional placement used by Linear,
 *       Notion, Stripe. State persists in localStorage.
 *
 *   mode="mobile"  (< 768 px viewport)
 *     - Sidebar is hidden off-canvas as a drawer overlay.
 *     - <MobileNavTrigger /> renders a hamburger that toggles `open`.
 *     - Backdrop click + Esc dismiss the drawer.
 *     - Body scroll is locked while the drawer is open.
 *
 * Body attributes (read by CSS):
 *   data-sidebar-mode="desktop" | "mobile"
 *   data-sidebar-open="true" | "false"     (only meaningful on mobile)
 *   data-sidebar-collapsed="true" | "false" (only meaningful on desktop)
 */

const STORAGE_KEY = 'seasid.sidebar.collapsed';

function readStoredCollapsed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredCollapsed(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore quota / privacy mode */
  }
}

function pickMode(width) {
  return width >= 768 ? 'desktop' : 'mobile';
}

function makeMatchMedia() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    const noop = () => {};
    const stub = {
      matches: true,
      media: '',
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    };
    return () => stub;
  }
  return window.matchMedia.bind(window);
}

const SidebarContext = createContext({
  mode: 'desktop',
  collapsed: false,
  open: false,
  toggleCollapse: () => {},
  toggleMobile: () => {},
  closeMobile: () => {},
});

export function SidebarProvider({ children }) {
  const [mode, setMode] = useState('desktop');
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);

  // Read persisted collapsed on mount.
  useEffect(() => {
    setCollapsed(readStoredCollapsed());
  }, []);

  // Track viewport mode via matchMedia + resize listener (defensive).
  useEffect(() => {
    const matchMedia = makeMatchMedia();
    const compute = () => setMode(pickMode(window.innerWidth));
    compute();

    const mqMobileMax = matchMedia('(max-width: 767px)');
    const mqDesktop   = matchMedia('(min-width: 768px)');

    const onChange = () => compute();
    mqMobileMax.addEventListener('change', onChange);
    mqDesktop.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      mqMobileMax.removeEventListener('change', onChange);
      mqDesktop.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  // Persist collapsed on change.
  useEffect(() => {
    writeStoredCollapsed(collapsed);
  }, [collapsed]);

  // If we leave mobile while the drawer is open, close it.
  useEffect(() => {
    if (mode !== 'mobile' && open) setOpen(false);
  }, [mode, open]);

  // Esc closes the drawer when open.
  useEffect(() => {
    if (mode !== 'mobile' || !open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, open]);

  // Body attributes that the CSS reads.
  useEffect(() => {
    const body = document.body;
    body.setAttribute('data-sidebar-mode', mode);
    body.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
    body.setAttribute('data-sidebar-open', open ? 'true' : 'false');

    // Body-scroll lock while the mobile drawer is open.
    if (mode === 'mobile' && open) {
      const prev = body.style.overflow;
      body.style.overflow = 'hidden';
      return () => {
        body.style.overflow = prev;
      };
    }
  }, [mode, collapsed, open]);

  const toggleCollapse = useCallback(() => setCollapsed((v) => !v), []);
  const toggleMobile   = useCallback(() => setOpen((v) => !v), []);
  const closeMobile     = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ mode, collapsed, open, toggleCollapse, toggleMobile, closeMobile }),
    [mode, collapsed, open, toggleCollapse, toggleMobile, closeMobile]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  return useContext(SidebarContext);
}
