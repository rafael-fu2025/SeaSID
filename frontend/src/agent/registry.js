/**
 * Static snapshot of the SeaSID agent's tool registry.
 *
 * Mirrors `backend/app/lib/agent_tools.py`. Kept client-side so the Settings
 * page can render the table without round-tripping the API. If you add a new
 * tool on the backend, also add it here so the two stay in sync.
 *
 * The `params` field is a human-readable summary — not a full JSON Schema.
 */

export const AGENT_TOOLS = [
  {
    name: 'get_forecast',
    description:
      'Returns the current dive-condition forecast and risk assessment for a specific site (visibility, current, overall risk, P(no-go), 11-feature snapshot).',
    params: [
      { name: 'site_key', type: 'string', required: true, description: 'Site identifier (dauin_muck | apo_reef).' },
    ],
  },
  {
    name: 'get_weather',
    description:
      'Returns detailed weather data for a site including precipitation (24h/48h/3h), wind max/mean, wave max, sea temperature, and tides.',
    params: [{ name: 'site_key', type: 'string', required: true, description: 'Site identifier.' }],
  },
  {
    name: 'list_sites',
    description: 'Lists every registered dive site with name, type (muck/reef), coordinates, and description.',
    params: [],
  },
  {
    name: 'get_model_info',
    description:
      'Returns information about the currently loaded prediction model, including type (lstm/xgboost/rule_based), training-set size, and top-5 feature importances when XGBoost is loaded.',
    params: [],
  },
  {
    name: 'get_history',
    description:
      'Returns recent label history (dive / poor_viz / no_dive) for a site over the past N days.',
    params: [
      { name: 'site_key', type: 'string', required: true, description: 'Site identifier.' },
      { name: 'days', type: 'integer', required: false, description: '1–30, default 7.' },
    ],
  },
  {
    name: 'check_alerts',
    description:
      'Returns recent alerts (last 24 hours) for a site — kind, message, channel (in-app or email).',
    params: [{ name: 'site_key', type: 'string', required: true, description: 'Site identifier.' }],
  },
];
