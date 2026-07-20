import { useCallback, useEffect, useState } from 'react';

/** Persist and synchronize the desktop navigation rail's collapsed state. */
const KEYS = {
  left: 'seasid.cockpit.leftCollapsed',
};
const LEGACY_KEYS = [
  'seasid.cockpit.rightCollapsed',
  'seasid.cockpit.v3',
];

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
  const [leftCollapsed, setLeftCollapsed] = useState(() => readBool(KEYS.left, false));

  useEffect(() => { writeBool(KEYS.left, leftCollapsed); }, [leftCollapsed]);

  // Multi-tab sync: listen for storage events from other tabs / windows.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (e) => {
      if (e.key === KEYS.left) setLeftCollapsed(readBool(KEYS.left, false));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleLeft = useCallback(() => setLeftCollapsed((value) => !value), []);
  const reset = useCallback(() => {
    setLeftCollapsed(false);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(KEYS.left);
        LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
      } catch { /* ignore */ }
    }
  }, []);

  return {
    leftCollapsed,
    toggleLeft,
    reset,
  };
}
