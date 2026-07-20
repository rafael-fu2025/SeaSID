/**
 * Static snapshot of the SeaSID agent's tool registry.
 *
 * Used as the initial render for the Settings → Agent tab. The page also
 * fetches `/api/v1/agent/tools` on mount and merges MCP-sourced tools
 * (e.g. `web_search`, `web_browse` from the MiniMax coding-plan MCP) into
 * the table so the UI stays in sync with the live backend without a redeploy.
 *
 * The `params` field is a human-readable summary — not a full JSON Schema.
 */

function siteKeyParam() {
  return { name: 'site_key', type: 'string', required: true, description: 'Site identifier.' };
}

export const AGENT_TOOLS = [
  {
    name: 'get_forecast',
    description:
      'Returns the current dive-condition forecast and risk assessment for a specific site (visibility, current, overall risk, P(no-go), 14-feature snapshot, optional air-quality block).',
    params: [
      { ...siteKeyParam(), description: 'Site identifier (dauin_muck | apo_reef).' },
    ],
  },
  {
    name: 'get_weather',
    description:
      'Returns detailed weather data for a site including precipitation (24h/48h/3h), wind max/mean, wave max, sea temperature, and tides.',
    params: [siteKeyParam()],
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
      siteKeyParam(),
      { name: 'days', type: 'integer', required: false, description: '1–30, default 7.' },
    ],
  },
  {
    name: 'check_alerts',
    description:
      'Returns recent alerts (last 24 hours) for a site — kind, message, channel (in-app or email).',
    params: [siteKeyParam()],
  },
  {
    name: 'get_air_quality',
    description:
      'Returns the most recent air-quality snapshot for a site (AQI, PM2.5, PM10, O3, NO2) sourced from AQICN. Returns available=false when the site is opted out (no nearby station).',
    params: [siteKeyParam()],
  },
];

/**
 * Flatten a JSON Schema's `properties`/`required` into the human-readable
 * shape the table expects. Nested objects (queries, etc.) are shown as
 * their own row so the operator can see at a glance what the LLM can pass.
 */
export function schemaToParams(schema, parentName = '') {
  if (!schema || typeof schema !== 'object') return [];
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const out = [];
  for (const [name, def] of Object.entries(properties)) {
    const fullName = parentName ? `${parentName}.${name}` : name;
    const type = def.type || (def.$ref ? 'object' : 'string');
    out.push({
      name: fullName,
      type,
      required: required.has(name),
      description: def.description || '',
    });
    if (def.type === 'object' && def.properties) {
      out.push(...schemaToParams(def, fullName));
    } else if (def.type === 'array' && def.items && def.items.type === 'object') {
      out.push(...schemaToParams(def.items, `${fullName}[]`));
    }
  }
  return out;
}
