const VERSION = 'v1';
export const FORECAST_CACHE_TTL_MS = 5 * 60 * 1000;

// Scoped keys let each page cache its own payload shape per site:
//   forecast  → { briefing, forecast }        (Forecast page)
//   dashboard → { forecast, alerts }          (Dashboard page)
// The 'forecast' scope key format predates scoping, so existing cached
// entries keep working.
const keyFor = (scope, siteKey) => `seasid.${scope}.${VERSION}:${siteKey}`;

function readScopedCache(scope, siteKey, now = Date.now()) {
  try {
    const raw = window.localStorage.getItem(keyFor(scope, siteKey));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.savedAt || now - entry.savedAt > FORECAST_CACHE_TTL_MS) {
      window.localStorage.removeItem(keyFor(scope, siteKey));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeScopedCache(scope, siteKey, payload, now = Date.now()) {
  const entry = { ...payload, savedAt: now };
  try {
    window.localStorage.setItem(keyFor(scope, siteKey), JSON.stringify(entry));
  } catch {
    // Private browsing or quota exhaustion must not block forecasts.
  }
  return entry;
}

function clearScopedCache(scope, siteKey) {
  try {
    window.localStorage.removeItem(keyFor(scope, siteKey));
  } catch {
    // Storage may be unavailable.
  }
}

// Forecast page (briefing + forecast).
export const readForecastCache = (siteKey, now = Date.now()) =>
  readScopedCache('forecast', siteKey, now);
export const writeForecastCache = (siteKey, payload, now = Date.now()) =>
  writeScopedCache('forecast', siteKey, payload, now);
export const clearForecastCache = (siteKey) =>
  clearScopedCache('forecast', siteKey);

// Dashboard page (forecast + alerts) — same TTL, separate entry, so a
// route swap to Settings and back rehydrates instantly instead of
// flashing skeletons and refetching data that is seconds old.
export const readDashboardCache = (siteKey, now = Date.now()) =>
  readScopedCache('dashboard', siteKey, now);
export const writeDashboardCache = (siteKey, payload, now = Date.now()) =>
  writeScopedCache('dashboard', siteKey, payload, now);
export const clearDashboardCache = (siteKey) =>
  clearScopedCache('dashboard', siteKey);
