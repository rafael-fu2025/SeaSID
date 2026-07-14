# SeaSID model audit and retraining guide

## Decision

Do not promote a retrained XGBoost or LSTM yet. The database currently has
181 labels, but only one is a genuine operator record. The other 180 are seed
or rule-generated records. A model trained on those records learns the label
generator, not actual dive safety. The new scripts therefore produce
versioned candidate artifacts and refuse to imply production readiness until
there are at least 500 trusted labels and at least 100 records in each class.

This is a binary classification problem at a fixed forecast horizon:

- `target=1`: a scheduled dive was actually judged no-go or poor visibility.
- `target=0`: a scheduled dive actually proceeded under acceptable conditions.
- `issue_ts`: when SeaSID must make the prediction.
- `target_ts`: the dive decision/observation time.

It is also a time-series problem because the inputs are ordered hourly
observations or forecasts. It is not currently a regression problem. A future
visibility model can separately predict `actual_viz_m` with MAE/RMSE and feed
that estimate into the final classifier.

## What the audit found

The reproducible audit is `python -m scripts.audit_training_data`. Its current
report is written to `data/quality/audit.json`.

| Finding | Current state | Consequence |
|---|---:|---|
| Labels | 181 over 2026-04-11 to 2026-07-09 | Too short to cover seasons or rare events |
| Trusted operator labels | 1 | No defensible supervised ground truth |
| Seed labels | 102 | Useful for UI/tests only |
| Synthetic rule labels | 78 | Circular if used to assess the same rules |
| Label classes | 56 go, 125 no-go/poor-viz | Imbalanced and strongly time-dependent |
| Weather rows | 2,320/site | About 97 days, not multiple seasons |
| Missing sea temperature | 4,448/4,640 | Default 28 C dominates this feature |
| Marine rows | 96/site | Only about four days |
| Missing wave period/current | 100% of marine rows | Defaults dominate the historical training period |
| Tide rows | 49/site | Only about two days |
| Air-quality rows | 0 | AQI and PM2.5 are constants |
| Duplicate outcome | 1 duplicate site/day in the merged export | Must be resolved before training |

The original XGBoost implementation used fixed weak parameters and
Leave-One-Out or ordinary k-fold validation. Those folds are inappropriate for
overlapping time windows. It also reported ROC-AUC calculated on the same data
used for final fitting, which overstates generalization.

The original LSTM fitted its scaler and class weight before the validation
boundary and reported metrics over more than the untouched validation data.
Those paths are now fitted from training records only. Batched historical
features also reused the latest air-quality value for earlier timestamps; each
timestamp now gets only the latest air record available at its own cutoff.

Other important limitations remain:

- The existing day-level label has no precise dive time, so the pipeline uses
  noon UTC as an explicit convention. Collect the real decision time.
- The older feature builder replaces missing marine/tide/air fields with
  climatological constants. This hides missingness. Collect those inputs and
  add coverage/age indicators before promotion.
- Historical reanalysis is not the same as the forecast available to the
  operator. For a 24- or 48-hour product, archive forecast runs with both
  `issue_ts` and `valid_ts`.
- Adjacent LSTM windows overlap heavily. The chronological purge is therefore
  essential.

## Required dataset contracts

### Outcome labels

One unique record per `site_key` and actual dive decision time:

| Column | Type | Required | Meaning |
|---|---|---:|---|
| `site_key` | string/category | yes | `dauin_muck` or `apo_reef` |
| `date` | ISO date | yes | Local date of the scheduled dive |
| `decision_ts_utc` | UTC timestamp | recommended | Exact time the operator made the decision |
| `label` | category | yes | `dive`, `poor_viz`, or `no_dive` |
| `source` | string | yes | Verifiable source such as `operator_shop_a` |
| `actual_viz_m` | float | recommended | Measured or consistently estimated visibility |
| `actual_current` | category | recommended | `Low`, `Moderate`, or `High` using a written rubric |
| `no_go_reason` | category/text | required for no-go | Primary reason, not a model-generated reason |
| `confidence` | category | yes | `low`, `med`, or `high` |
| `comments` | text | optional | Observation notes |

Never label a day as no-go merely because no dive was scheduled. Do not derive
labels from the same wind/rain thresholds the model is meant to improve.
Record the outcome after the dive/decision and preserve provenance.

### Hourly covariates

Each row needs `site_key`, `valid_ts_utc`, `source`, and numeric values with
units. Forecast inputs additionally need `issue_ts_utc`, `forecast_lead_hours`,
and `model_run_id`.

Recommended fields are precipitation, rain intensity, air temperature,
humidity, pressure, wind mean/gust/direction, wave height/period/direction,
swell height/period/direction, sea-surface temperature, current speed/direction,
tide height/range/phase, river discharge or coastal turbidity proxy, and data
age/coverage flags.

XGBoost benefits from raw current values, 3/6/12/24/48-hour lags, trailing
sums/means/maxima, changes, interactions, cyclic hour/day/season fields, site
category, and explicit missingness indicators. LSTM should receive the same
multivariate variables as a chronologically ordered tensor, preferably at an
hourly frequency, with a tuned 12/24/48/72-hour lookback. Scaling is fitted on
training timesteps only. Padding is not appropriate for these fixed-frequency
windows; reject or mask incomplete sequences instead.

Collect at least two full years of hourly covariates so wet/dry seasons are
represented. The configured minimum for any promotion is 500 trusted labels
with 100 per class; a more credible target is 1,000-2,000 outcomes, at least
200 per class and coverage across both sites and seasons. The LSTM is more
data-hungry than XGBoost and should remain secondary until this is met.

## Recommended legal data sources

| Source | Fields and format | Update/access | Limits and matching method |
|---|---|---|---|
| [PAGASA climatological data](https://www.pagasa.dost.gov.ph/climate/climate-data) | Official station rainfall, wind, temperature and related fields; raw Excel by request | Authorized request under PAGASA terms | Station coverage and request terms apply. Map station coordinates to the nearest SeaSID site and retain station ID/source. Do not scrape the dynamic page without written permission. |
| [Open-Meteo Previous Runs](https://open-meteo.com/en/docs/previous-runs-api) | Hourly temperature, humidity, precipitation, pressure, cloud and wind from fixed 1-7 day lead times; JSON/CSV | HTTP API; most fixed-lead history from 2024 | Model output, not an on-site observation; licensing/usage tier applies. Join `_previous_day1` or `_previous_day2` by valid time to reproduce 24/48-hour information. |
| [Open-Meteo Historical Forecast](https://open-meteo.com/en/docs/historical-forecast-api) | Stitched hourly operational forecasts; JSON/CSV | HTTP API; roughly 2021 onward depending on model | Model versions change. Use for covariate history, but prefer previous/single runs when exact lead time matters. |
| [Open-Meteo Historical Weather](https://open-meteo.com/en/docs/historical-weather-api) | ERA5/ERA5-Land/IFS temperature, precipitation, wind, pressure and humidity; JSON/CSV | Hourly; ERA5 commonly has about a five-day delay | Reanalysis is spatially coarse and not a forecast-as-issued record. Join nearest grid cell by `site_key, valid_ts`. |
| [Copernicus Global Ocean Physics](https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_PHY_001_024/description) | Surface current components, temperature, sea level, salinity; NetCDF | Hourly surface fields, daily update through the Marine Data Store | Free registration and attribution required; 0.083-degree model grid is not reef-scale. Subset around each site and retain product/dataset version. |
| [Copernicus Global Ocean Waves](https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027/description) | Significant/max wave height, wave/swell periods and directions, Stokes drift; NetCDF | Three-hourly dataset, updated daily | Numerical model and coastal-grid limitations. Resample to hourly without pretending interpolated values are observations. |
| [NASA POWER Hourly API](https://power.larc.nasa.gov/docs/services/api/temporal/hourly/) | Temperature, humidity, precipitation, surface pressure, wind speed/direction; JSON/CSV/NetCDF | 2001 to near-real-time | Reanalysis/grid-average fields; a request is limited to 15 parameters. Use as a long-history fallback and join by nearest site coordinates and UTC hour. |
| Authorized dive-shop logs | Actual dive/no-dive, visibility, current, reason, time; CSV/API/export | After each scheduled dive | This is the essential target source. Obtain consent/data agreement, pseudonymize people, and deduplicate by shop/site/decision time. |

Respect provider terms, rate limits, attribution and retention rules. `robots.txt`
permission is not a substitute for contractual permission. The implemented
collector uses documented APIs and does not scrape web pages.

## Implemented pipeline

`config/ml_pipeline.json` contains paths, date ranges, API settings, split
policy, search spaces and seeds. Secrets stay in `.env`; the collector reads
`OPEN_METEO_API_KEY` when present. Generated files are ignored by Git.

Run all commands from `backend`:

```powershell
.venv\Scripts\python.exe -m scripts.audit_training_data --output data\quality\audit.json

# Download immutable raw API responses in monthly chunks. Existing chunks
# are skipped; retries, Retry-After handling, timeouts and rate limiting apply.
.venv\Scripts\python.exe -m scripts.collect_ml_data --start 2024-01-01 --end 2026-07-09

# Validate ranges/types, reject invalid records, and create a versioned CSV.
.venv\Scripts\python.exe -m scripts.clean_ml_data

# Merge authorized outcome exports without modifying seasid.db.
.venv\Scripts\python.exe -m scripts.merge_ml_dataset --add data\authorized\shop_a.csv

# Build leakage-safe examples. This default uses trusted sources only.
.venv\Scripts\python.exe -m scripts.build_training_dataset --horizon 24

# Synthetic data is diagnostic only and is never promotion-eligible.
.venv\Scripts\python.exe -m scripts.build_training_dataset --horizon 24 --include-synthetic

.venv\Scripts\python.exe -m scripts.train_xgb_improved --dataset data\ml\processed\training_examples_h24_<version>.csv
.venv\Scripts\python.exe -m scripts.train_lstm_improved --dataset data\ml\processed\training_examples_h24_<version>.csv

.venv\Scripts\python.exe -m scripts.evaluate_models `
  --xgb-predictions data\ml\reports\xgb_test_predictions_<version>_<stamp>.csv `
  --lstm-predictions data\ml\reports\lstm_test_predictions_<version>_<stamp>.csv `
  --xgb-metrics data\ml\reports\xgb_candidate_<version>_<stamp>.json `
  --lstm-metrics data\ml\reports\lstm_candidate_<version>_<stamp>.json

.venv\Scripts\python.exe -m pytest tests\test_ml_pipeline.py tests\test_lstm.py tests\test_xgb.py -q
```

Raw responses live under `data/ml/raw`; cleaned/versioned tables under
`data/ml/processed`; candidate models under `data/ml/artifacts`; quality,
metrics, predictions and plots under `data/ml/reports`. Original source files
and the production database are never overwritten.

## Validation and feature safeguards

- Labels and examples are sorted chronologically.
- Train/validation/test are 70/15/15 with a 48-hour purge at boundaries.
- XGBoost tuning uses purged expanding time-series folds and validation
  average precision. The final test is read once after selection.
- XGBoost uses median imputation learned from training data, class weighting,
  RandomizedSearchCV, early stopping, interactions and cyclic time features.
- LSTM tuning covers sequence length, layers, units, dropout, batch size,
  learning rate and Adam/AdamW. It uses training-only scaling and class
  weights, gradient clipping, EarlyStopping behavior, ReduceLROnPlateau and a
  saved best checkpoint.
- PyTorch's built-in `nn.LSTM` has inter-layer dropout but no recurrent-dropout
  parameter. `recurrent_dropout` is therefore explicitly zero instead of
  claiming an unsupported regularizer.
- Candidate bundles store feature order, scaler/imputer, horizon, threshold,
  dataset hash, sample count, metrics and hyperparameters.
- No script automatically copies a candidate over `seasid_xgb.pkl` or
  `seasid_lstm.pt`.

## Current diagnostic results

These numbers are not evidence of improvement because 180/181 labels are
seed/synthetic and the common test period has 27 positive records and only one
negative. They demonstrate that the new evaluation catches the failure mode.

| Model/protocol | Accuracy | Balanced accuracy | F1 | ROC-AUC | Interpretation |
|---|---:|---:|---:|---:|---|
| Previous XGBoost experiment | 0.519 | not recorded | 0.667 | 0.885 | Test had 26 positive and 1 negative; training AUC was also reported elsewhere |
| New XGBoost, fixed 0.5 | 0.429 | 0.222 | 0.600 | 0.130 | Poor ordering on the single-negative test |
| Previous LSTM experiment | 0.185 | not recorded | 0.267 | 0.827 | Very low recall and tiny test set |
| New LSTM, fixed 0.5 | 0.286 | 0.630 | 0.412 | 0.500 | No useful discrimination |
| New ensemble, fixed 0.5 | 0.143 | 0.074 | 0.250 | 0.056 | Worse; do not deploy |

The validation-selected threshold for both new candidates was 0.10. At that
threshold each predicted every test record as no-go, producing 96.4% accuracy
and 50% balanced accuracy. This is the exact misleading “accuracy
improvement” the safeguards are designed to expose.

Selected diagnostic hyperparameters:

- XGBoost: 700 estimators, learning rate 0.01, depth 4, min child weight 2,
  subsample/column sample 0.9, gamma 0.3, alpha 0.1, lambda 10.0, class weight
  0.519. Training was about 3.8 s and mean test inference about 0.07 ms/row on
  the final local run.
- LSTM: 12-hour sequence, one 32-unit layer, dropout 0.3, Adam, learning rate
  0.001, batch size 32. Training was about 6.7 s and mean test inference about
  0.09 ms/row. The low time reflects early stopping on this tiny dataset.

XGBoost should be the first production candidate once real labels exist: it is
easier to audit, handles a modest tabular dataset better and exposes feature
importance. Reconsider LSTM after substantially more labeled sequences exist.
Only test an ensemble after both components independently beat the prevalence
and rule baselines on the same balanced, untouched time period.

## Next steps

1. Fix the duplicate site/day outcome and collect exact decision timestamps.
2. Start mandatory structured operator logging at both sites; target at least
   500 trusted labels before the first promotion review.
3. Archive 24- and 48-hour forecast runs at ingestion time with issue/run and
   valid timestamps. Backfill fixed-lead Previous Runs data where licensing
   and availability permit.
4. Backfill at least two years of weather plus Copernicus current/wave/sea
   temperature. Add coverage and staleness indicators instead of silent
   constants.
5. Re-run the full workflow. Require both classes in every split, compare
   PR-AUC/balanced accuracy/calibration, and inspect errors by site, season and
   no-go reason.
6. Promote only after a written acceptance threshold is met on an untouched
   period and a shadow deployment confirms calibration and latency.
