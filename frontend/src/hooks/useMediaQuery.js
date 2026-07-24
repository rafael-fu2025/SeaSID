import { useEffect, useState } from 'react';

/**
 * useMediaQuery - SSR-safe media-query hook.
 *
 * Returns the current matchMedia() value for the given CSS query. Updates
 * reactively when the viewport crosses the breakpoint. Safe to call during
 * SSR: it returns false on the server and hydrates to the real value
 * once mounted.
 *
 * Usage:
 *   const isDesktop = useMediaQuery('(min-width: 1024px)');
 *   const isCoarse  = useMediaQuery('(pointer: coarse)');
 *
 * Also exported as useIsDesktop() for the project's common case -
 * matches Tailwind's lg breakpoint (1024 px) which is the same width
 * we use to flip the cockpit from persistent rails to drawer overlay.
 */
export function useMediaQuery(query) {
  const get = () =>
    typeof window !== 'undefined' && window.matchMedia(query).matches;

  const [matches, setMatches] = useState(get);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia(query);

    // Sync once on mount in case it changed between render and effect.
    if (mql.matches !== matches) setMatches(mql.matches);

    // Sync to matchMedia's reported value directly. We deliberately do NOT
    // compare against the captured `matches` variable: the effect only
    // re-runs when `query` changes, so this handler closure captures
    // `matches` from the initial render and would otherwise go stale after
    // the first match-toggling event (e.g. a desktop -> mobile -> desktop
    // zoom cycle would never report `true` again).
    const handler = (event) => {
      setMatches(event.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
    // `matches` deliberately omitted - see comment above; the handler reads
    // the current value off the event so it never needs a closure fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return matches;
}

export const LG_BREAKPOINT_PX = 1024;

export function useIsDesktop() {
  return useMediaQuery(`(min-width: ${LG_BREAKPOINT_PX}px)`);
}
