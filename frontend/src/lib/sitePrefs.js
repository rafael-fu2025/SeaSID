/**
 * sitePrefs — the "Default site" Settings control (audit F-F4-02) was
 * persisted but never consumed; these helpers are its single read path.
 * AgentFab / Dashboard / Forecast use getInitialSiteKey() so the Settings
 * choice actually pre-selects the site.
 */
const DEFAULT_SITE_KEY = 'seasid.defaultSite';
const FALLBACK_SITE = 'dauin_muck';

export function getInitialSiteKey() {
  try {
    const value = window.localStorage.getItem(DEFAULT_SITE_KEY);
    return value || FALLBACK_SITE;
  } catch {
    return FALLBACK_SITE;
  }
}

export { DEFAULT_SITE_KEY, FALLBACK_SITE };
