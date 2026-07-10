import { useEffect, useState } from 'react';
import { api } from '@/api';

/**
 * useInspectorData — shared hook the Inspector pulls from so its data
 * is consistent with the active page's site selection.
 *
 * Returns { data, loading, error, refetch }.
 *
 *  - data shape:
 *      {
 *        site_key, site_name,
 *        current_risk, p_bad,
 *        air: { available, aqi, quality, station_name? },
 *        wind_max_kmh, sea_temp_c,
 *        optimal_window: { ts, p_bad, viz_label },
 *        alert_count, top_alerts: [{ kind, message }],
 *      }
 *
 * The hook re-fetches whenever `siteKey` changes. Cancellation flag
 * guards against late-arriving responses after a fast site-switch.
 */
export function useLiveInspectorData(siteKey = 'dauin_muck') {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancel = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.all([
      api.getForecast(siteKey).catch((e) => ({ __error: e.message })),
      api.getAlerts(siteKey).catch((e) => ({ __error: e.message })),
    ])
      .then(([fc, al]) => {
        if (cancel) return;
        if (fc?.__error) {
          setState({ data: null, loading: false, error: fc.__error });
          return;
        }
        const cur = fc?.hours?.[0];
        const alerts = al?.alerts || [];
        setState({
          loading: false,
          error: null,
          data: {
            site_key: fc?.site_key || siteKey,
            site_name: fc?.site_name,
            current_risk: cur?.current_risk,
            p_bad: cur?.p_bad,
            air: fc?.air,
            wind_max_kmh: cur?.wind_max_kmh,
            sea_temp_c: cur?.sea_temp_c,
            optimal_window: fc?.optimal_window,
            alert_count: alerts.length,
            top_alerts: alerts.slice(0, 3),
          },
        });
      })
      .catch((err) => {
        if (!cancel) setState({ data: null, loading: false, error: err.message });
      });

    return () => { cancel = true; };
  }, [siteKey]);

  return state;
}
