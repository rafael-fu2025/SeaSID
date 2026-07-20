# SeaSID Weather Provider Registry

`app/lib/providers/` is a pluggable layer that lets SeaSID swap external
weather / marine / air-quality data sources without touching the ingest
pipeline, the feature builder, or the agent tools.

## Roles

| Role | Default | Optional |
|---|---|---|
| `weather` — surface weather (precip, wind, basic waves) | `open_meteo` | — |
| `marine` — wave period, swell, currents, water temp | `open_meteo` | `stormglass` |
| `air` — AQI, PM2.5, PM10, O₃, NO₂ | `off` | `aqicn` |

Selection is per-role via environment variables:

```bash
# defaults
SEASID_PROVIDER_WEATHER=open_meteo
SEASID_PROVIDER_MARINE=open_meteo
SEASID_PROVIDER_AIR=off

# enable Storm Glass marine augmentation
SEASID_PROVIDER_MARINE=stormglass

# enable AQICN air-quality feed
SEASID_PROVIDER_AIR=aqicn
```

Provider credentials are managed in **Settings → API keys**, encrypted in
`backend/data/seasid.db`, and rotated among enabled keys for each provider.

## Adding a new provider

1. Subclass `WeatherProvider`, `MarineProvider`, or `AirQualityProvider` in
   `base.py`.
2. Implement the `fetch_*` method(s).
3. Return the canonical unit shapes documented in `base.py`.
4. Resolve keys through `app.lib.provider_keys` and tolerate missing keys.
5. Register it in `registry._build_*()`.

## Schema migrations

The provider layer adds two tables:

- `marine_obs` — wave_height_m, wave_period_s, swell_height_m, swell_direction_deg,
  water_temp_c, current_speed_ms, current_direction_deg, source
- `air_quality_obs` — aqi, pm25, pm10, o3, no2, station_id, station_name, source

Both have a `(site_key, ts)` unique constraint so re-ingestion is idempotent.
The `weather_obs` table gained an optional `source` column.

The feature vector grew from 11 → 14 columns (additive; legacy 11-feature
models still work):

```
12. aqi_recent
13. pm25_recent
14. wave_period_s_mean
```

If air/marine data is missing at inference time, climatological defaults
are used (AQI 30, PM2.5 8 µg/m³, wave period 6 s) — these match background
tropical-marine values for the Philippines.

## Rate-limit notes

| Provider | Free-tier limit | Cache strategy |
|---|---|---|
| Open-Meteo Forecast | none | re-ingest every 6h |
| Open-Meteo Marine | none | re-ingest every 6h |
| Storm Glass | 50 req/day, 10/hr | re-ingest every 6h (≤4 sites = ~16/day) |
| AQICN | 1000 req/day, 1/s | re-ingest every 30min (≤2 sites = 96/day) |

## AQICN distance caveat

The free AQICN tier returns the **nearest global monitoring station** —
for remote coastal sites like Dauin or Apo Island, the nearest station can
be **>1000 km away** (Sandakan, Sabah). The provider records
`distance_km` + `quality` (`local` / `regional` / `distant` / `very_distant`)
and emits a warning log so callers can surface this honestly.

To opt out per site, set `"air_provider_disabled": true` in
[`app/lib/sites.py`](app/lib/sites.py). Both anchor sites default to
disabled since the free-tier stations are too far to be useful.

When a closer station appears (or when a paid AQICN tier unlocks more
granular data), flip the flag back to false and re-ingest.
