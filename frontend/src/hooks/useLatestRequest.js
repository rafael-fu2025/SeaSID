import { useRef } from 'react';

/**
 * useLatestRequest — race guard for async data loading (audit F-F2-03).
 *
 * Returns `{ begin, isCurrent }`: call `begin()` before starting a load
 * (it hands you a monotonically-increasing token) and `isCurrent(token)`
 * before applying results. Stale responses from superseded loads are
 * ignored instead of overwriting newer state.
 *
 * The Dashboard previously used a single boolean for this; quick site
 * switching let an older response win because the newer load reset the
 * flag before the old promise resolved.
 */
export function useLatestRequest() {
  const tokenRef = useRef(0);

  const begin = () => ++tokenRef.current;
  const isCurrent = (token) => token === tokenRef.current;

  return { begin, isCurrent };
}

export default useLatestRequest;
