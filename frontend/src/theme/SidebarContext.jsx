import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * SidebarContext — owns all sidebar state across the four breakpoints.
 *
 * Breakpoints (Tailwind-aligned):
 *   xs  < 640   — phone portrait
 *   sm  640–767 — phone landscape / small tablet
 *   md  768–1023 — tablet
 *   lg  1024–1439 — desktop
 *   xl  ≥1440  — wide desktop
 *
 * Sidebar shape per mode:
 *   'drawer'   : hidden by default; slide-in overlay with backdrop.
 *                Used on xs/sm and as a fallback when md is below 768.
 *   'narrow'   : persistent 64 px rail, no labels.
 *                Used on md (768–1023).
 *   'full'     : persistent sidebar; user can collapse to 64 px rail via
 *                the chevron pill. Used on lg / xl.
 *
 * Body attributes we drive (CSS reads these):
 *   data-sidebar-mode="drawer" | "narrow" | "full"
 *   data-sidebar-collapsed="true" | "false"   (only meaningful for mode=full)
 *   data-sidebar-open="true" | "false"        (only meaningful for mode=drawer)
 *
 * We pick the breakpoint on mount and on every resize listener fire (without
 * polling) and persist the user's manual collapsed preference (lg/xl only)
 * to localStorage so it survives reloads.
 */

const STORAGE_KEY = 'seasid.sidebar.collapsed';

const bp = (w) => {
  if (w < 768) return 'drawer';
  if (w < 1024) return 'narrow';
  return 'full';
};

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

/* Safe matchMedia factory — returns a working MediaQueryList stub when
   running under test runners (jsdom) that don't implement it. */
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
  mode: 'full',
  collapsed: false,
  mobileOpen: false,
  toggleCollapse: () => {},
  toggleMobile: () => {},
  closeMobile: () => {},
  setCollapsed: () => {},
});

export function SidebarProvider({ children }) {
  // SSR-safe initialiser — defaults before first effect runs.
  const [mode, setMode] = useState('full');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Initialise from window.localStorage on mount only.
  useEffect(() => {
    setCollapsed(readStoredCollapsed());
  }, []);

  // Update mode + side-effect body attributes on every meaningful
  // change. We use `matchMedia` to subscribe to viewport changes,
  // not constant polling.
  useEffect(() => {
    const matchMedia = makeMatchMedia();
    const compute = () => setMode(bp(window.innerWidth));
    compute();

    const mqDesktop = matchMedia('(min-width: 1024px)');
    const mqTablet  = matchMedia('(min-width: 768px)');
    const mqXsOnly  = matchMedia('(max-width: 639px)');

    const onMq = () => compute();
    mqDesktop.addEventListener('change', onMq);
    mqTablet.addEventListener('change', onMq);
    mqXsOnly.addEventListener('change', onMq);

    // Also subscribe to plain resize as a backup (covers browsers that
    // don't fire matchMedia on virtual viewport changes like
    // dev-tools device emulation).
    window.addEventListener('resize', onMq);
    return () => {
      mqDesktop.removeEventListener('change', onMq);
      mqTablet.removeEventListener('change', onMq);
      mqXsOnly.removeEventListener('change', onMq);
      window.removeEventListener('resize', onMq);
    };
  }, []);

  // Persist collapsed state when it changes (only meaningful for full mode
  // but we save regardless — narrow/drawer never let the user collapse).
  useEffect(() => {
    writeStoredCollapsed(collapsed);
  }, [collapsed]);

  // Mirror state into body attributes for CSS.
  useEffect(() => {
    const body = document.body;
    body.setAttribute('data-sidebar-mode', mode);
    body.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
    body.setAttribute('data-sidebar-open', mobileOpen ? 'true' : 'false');

    // Lock body scroll while a drawer is open.
    if (mode === 'drawer' && mobileOpen) {
      const prev = body.style.overflow;
      body.style.overflow = 'hidden';
      return () => {
        body.style.overflow = prev;
      };
    }
  }, [mode, collapsed, mobileOpen]);

  // Reset ephemeral state ONLY when transitioning from drawer to a
  // wider mode (so a window-resize from phone to desktop dismisses the
  // drawer but the user can still toggle the drawer freely otherwise).
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === 'drawer' && mode !== 'drawer') {
      setMobileOpen(false);
    }
    prevModeRef.current = mode;
  }, [mode]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  const setCollapsedExplicit = useCallback((next) => {
    setCollapsed(Boolean(next));
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((v) => !v);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      collapsed,
      mobileOpen,
      toggleCollapse,
      toggleMobile,
      closeMobile,
      setCollapsed: setCollapsedExplicit,
    }),
    [mode, collapsed, mobileOpen, toggleCollapse, toggleMobile, closeMobile, setCollapsedExplicit]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  return useContext(SidebarContext);
}
