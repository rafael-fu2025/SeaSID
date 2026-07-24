const PREFIX = 'seasid.forecast.v1';
export const FORECAST_CACHE_TTL_MS = 5 * 60 * 1000;

const keyFor = (siteKey) => `${PREFIX}:${siteKey}`;

export function readForecastCache(siteKey, now = Date.now()) {
  try {
    const raw = window.localStorage.getItem(keyFor(siteKey));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.savedAt || now - entry.savedAt > FORECAST_CACHE_TTL_MS) {
      window.localStorage.removeItem(keyFor(siteKey));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeForecastCache(siteKey, payload, now = Date.now()) {
  const entry = { ...payload, savedAt: now };
  try {
    window.localStorage.setItem(keyFor(siteKey), JSON.stringify(entry));
  } catch {
    // Private browsing or quota exhaustion must not block forecasts.
  }
  return entry;
}

export function clearForecastCache(siteKey) {
  try {
    window.localStorage.removeItem(keyFor(siteKey));
  } catch {
    // Storage may be unavailable.
  }
}
