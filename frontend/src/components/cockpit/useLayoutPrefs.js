import { useCallback, useEffect, useState } from 'react';

/**
 * useLayoutPrefs — persistent collapse/expand booleans for the cockpit rails.
 *
 *  - leftCollapsed  : true  → SidebarNav renders as 64 px icon-only rail
 *                      false → SidebarNav renders as 240 px icon + label rail
 *  - rightCollapsed : true  → Inspector renders as 56 px vertical status strip
 *                      false → Inspector renders as 360 px full KPI panel
 *
 * Storage keys live under the `seasid.cockpit.*` namespace so they're
 * discoverable in DevTools and easy to wipe on a fresh visit:
 *
 *   localStorage.removeItem('seasid.cockpit.leftCollapsed');
 *   localStorage.removeItem('seasid.cockpit.rightCollapsed');
 *
 * Defaults: **both rails expanded on first visit** (the user can collapse
 * afterwards if they want maximum canvas space). This avoids the "I
 * can't see anything" trap that motivated this hook.
 */
const KEYS = {
  left:  'seasid.cockpit.leftCollapsed',
  right: 'seasid.cockpit.rightCollapsed',
};

function readBool(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* quota / private mode — silently ignore */
  }
}

export function useLayoutPrefs() {
  // SSR-safe initial reads; both default to *expanded* (false = not collapsed).
  const [leftCollapsed,  setLeftCollapsed]  = useState(() => readBool(KEYS.left,  false));
  const [rightCollapsed, setRightCollapsed] = useState(() => readBool(KEYS.right, false));

  // Persist on every change.
  useEffect(() => { writeBool(KEYS.left,  leftCollapsed);  }, [leftCollapsed]);
  useEffect(() => { writeBool(KEYS.right, rightCollapsed); }, [rightCollapsed]);

  // Multi-tab sync: listen for storage events from other tabs / windows.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (e) => {
      if (e.key === KEYS.left)  setLeftCollapsed(readBool(KEYS.left, false));
      if (e.key === KEYS.right) setRightCollapsed(readBool(KEYS.right, false));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleLeft  = useCallback(() => setLeftCollapsed((v)  => !v), []);
  const toggleRight = useCallback(() => setRightCollapsed((v) => !v), []);
  const reset       = useCallback(() => {
    setLeftCollapsed(false);
    setRightCollapsed(false);
    if (typeof window !== 'undefined') {
      try {
        // Also clear resizable-panels state and any stale autoSaveId
        // from earlier sessions so the user lands on a known-good layout.
        Object.keys(window.localStorage)
          .filter((k) =>
            k.startsWith('seasid') &&
            !k.startsWith('seasid.theme') &&
            !k.startsWith('seasid.defaultSite') &&
            !k.startsWith('seasid.toolsEnabled'),
          )
          .forEach((k) => window.localStorage.removeItem(k));
      } catch { /* ignore */ }
    }
  }, []);

  return {
    leftCollapsed,
    rightCollapsed,
    toggleLeft,
    toggleRight,
    reset,
  };
}
