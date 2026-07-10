import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

const STORAGE_KEY = 'seasid.theme';
const DEFAULT_THEME = 'dark';

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  cycleTheme: () => {},
});

const isValid = (t) => t === 'dark' || t === 'light';

function readInitialTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isValid(stored)) return stored;
  } catch {
    /* localStorage may be unavailable */
  }
  return DEFAULT_THEME;
}

/**
 * ThemeProvider — keeps `data-theme` on <html> in sync with state.
 *
 *  - the default is "dark" (locked-in from SeaSID.md), but
 *  - users may override via `seasid.theme` in localStorage
 *  - the Settings page writes through `setTheme`
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!isValid(next)) return;
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, cycleTheme }), [theme, setTheme, cycleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
