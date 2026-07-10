import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

const safeStorage = () => {
  try {
    if (typeof window !== 'undefined'
        && window.localStorage
        && typeof window.localStorage.clear === 'function') {
      return window.localStorage;
    }
  } catch {}
  return null;
};

beforeEach(() => {
  const ls = safeStorage();
  if (ls) {
    try { ls.clear(); } catch {}
  }
  document.documentElement.removeAttribute('data-theme');
});

function Probe() {
  const { theme, setTheme, cycleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('light')}>set-light</button>
      <button onClick={() => cycleTheme()}>cycle</button>
    </div>
  );
}

describe('ThemeContext', () => {
  it('defaults to dark when no localStorage entry exists', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reflects a pre-set DOM data-theme after a fresh render (idempotent loop)', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    // Toggle to light once.
    act(() => screen.getByText('set-light').click());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    // Toggle back to dark.
    act(() => screen.getByText('cycle').click());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setTheme updates the data-theme attribute', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByText('set-light').click());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('cycleTheme toggles between dark and light', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    act(() => screen.getByText('cycle').click());
    expect(screen.getByTestId('theme').textContent).toBe('light');
    act(() => screen.getByText('cycle').click());
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });
});
