# B2 — ML Stack Audit: model interface, LSTM, XGBoost, calibration, active learning, experiments, training scripts

> Audited 2026-09-19 · ~3,300 lines · Safety-lens: this stack produces the P(no-go) number that gates dive decisions

---

## 1. Scope

| File | Lines | Role |
|---|---:|---|
| `backend/app/lib/model.py` | 316 | Unified interface, tier selection, calibrator cache |
| `backend/app/lib/model_lstm.py` | 506 | PyTorch LSTM/GRU, training, persistence, inference |
| `backend/app/lib/model_xgb.py` | 183 | XGBoost baseline, LOO/5-fold CV |
| `backend/app/lib/calibration.py` | 299 | Platt/isotonic/identity calibrator + Brier/ECE |
| `backend/app/lib/active_learning.py` | 254 | Uncertainty-band label suggestion engine |
| `backend/app/lib/experiments.py` | 660 | Time-aware split, suite, ablations, plots |
| `backend/scripts/train_model.py` | 182 | Train both models from DB labels |
| `backend/scripts/train_calibrator.py` | 244 | Fit calibrator on time-aware holdout |
| `backend/scripts/expand_dataset.py` | 151 | 90-day archive + synthetic rule labels |
| `backend/scripts/run_experiments.py` | 96 | CLI experiment entry |

Core functions audited: `load_best`, `reload`, `selected_tier`, `tier_diagnostics`, `predict`, `get_calibrator`, `train_lstm`, `_compute_metrics`, `save_lstm`/`load_lstm`, `predict_proba_lstm(_batch)`, `train_xgb`, `predict_proba_xgb`, `Calibrator.auto/platt/isotonic/_for_univariate/predict`, `binary_entropy`, `suggest_active_labels`, `_replay_p_bad`, `_time_aware_split`, `run_full_experiment_suite`, `_run_ablations`, `_evaluate_rule_based`, `_load_training_data`, `_load_holdout`, `_rules_p`, `_lstm_p`.

---

## 2. How it works

**Tier system (as documented):** Tier 1 LSTM requires ≥500 samples and AUC ≥0.65; Tier 2 XGBoost requires ≥500 samples and AUC ≥0.60; Tier 3 rule-based. **As implemented: `load_best()` returns the LSTM bundle unconditionally and *raises RuntimeError* when the artifact is missing; the entire tier-gate block is unreachable code after an unconditional `return` (`model.py:125-187`).** The header docstring (`model.py:4-22`) still describes the gate behavior, including "Right now our LSTM was trained on 104 samples and has AUC ≈ 0.53, so the tier gates reject it" — which no longer happens.

**Training:** labels from `no_dive_labels` → features at 12:00 UTC per label date → binary y via `label_to_binary` (`dive`=0, `poor_viz`/`no_dive`=1). LSTM: StandardScaler → 85/15 time-aware (or random) split → `BCEWithLogitsLoss` with computed `pos_weight` → Adam + ReduceLROnPlateau + early stopping → metrics → `torch.save` bundle (`.pt`). XGBoost: LOO CV (≤20) or 5-fold → in-sample AUC → joblib bundle (`.pkl`).

**Inference:** `predict()` → `build_sequence` (N+1 per call) → `predict_proba_lstm` (logits → sigmoid) → persisted calibrator applied.

**Calibration:** `Calibrator.auto` — <30 holdout samples → identity; <5 unique probs → empirical-bin isotonic; else Platt, plus isotonic when ≥100, lower Brier wins. Persisted via pickle; `identity` passthrough if absent.

**Experiments:** time-aware blocked 70/15/15 split with a 1-day purge at the train/val boundary; rule/XGB/LSTM/GRU trained and scored on the test block; ablations on seq_len/hidden-size/feature-subsets; matplotlib plots; JSON results consumed by the Experiments page.

**Active learning:** last 7 days per site → skip labeled days → replay `predict()` at 12:00 UTC → keep p_bad ∈ [0.35, 0.65] → sort by entropy → top 3 nudge to operator.

---

## 3. Findings

### P0 — Safety-critical

**F-B2-01 · The documented model-qualification safety gate is dead code — production always serves the LSTM regardless of its measured quality** — `model.py:90-125` (active path) vs `model.py:127-187` (unreachable).
The gate constants (`LSTM_MIN_SAMPLES=500`, `LSTM_MIN_AUC=0.65`) exist, `_bundle_qualifies()` exists, tests exist (`tests/test_phase3_tier_selection.py`) — but the only live code path short-circuits them all. Consequence: the LSTM with AUC ≈ 0.53 (near-coin-flip, per the project's own docstring) is served as the *primary* safety forecast, while operators are told "production model configured as LSTM" with no quality gate. Two defensible fixes: (a) restore the tier gates (rules/XGB are safer on tiny data), or (b) deliberately keep LSTM-only but then delete the dead code + docstring fiction and expose measured metrics in the health endpoint. Current state is the worst of both: a gate that exists, tests that pass, and no gate at runtime.

**F-B2-02 · Calibrator is fit against a *different label definition* than the model predicts** — `scripts/train_calibrator.py:61` vs `scoring.py:109-111`.
`_load_holdout()` builds y as `1 if label == "no_dive" else 0` — treating `poor_viz` as a **go** day. Everywhere else (`label_to_binary`, train_model, experiments) `poor_viz` is a **no-go** (1). The production calibrator is therefore mapping model P(no-go) onto P(no_dive-only), systematically *understating* risk for poor-visibility days — the single most common marginal condition in coastal diving. With small holdouts the empirical-bin isotonic then memorizes the wrong mapping.

### P1 — High

**F-B2-03 · Data leakage in `train_lstm`: scaler fit + metrics computed on the full dataset** — `model_lstm.py:171-174` (scaler `fit_transform` over *all* sequences before the split), `model_lstm.py:314-316` (`_compute_metrics(model, X_scaled, y, config)` on train+val together).
(a) The StandardScaler statistics include validation rows — mild but real leakage into early stopping. (b) The persisted `lstm_metrics.json` (`accuracy/f1/auc_roc`) is computed **on the same data the model trained on**, so the file that any future tier gate, dashboard, or operator reads reports in-sample performance as if it were holdout performance. With 104 samples this inflates meaningfully. Fix: fit scaler on train indices only; compute persisted metrics on the val block only; add a separate `train_metrics` block if in-sample numbers are wanted.

**F-B2-04 · XGBoost `auc_roc` in `xgb_metrics.json` is in-sample** — `model_xgb.py:96-104`.
`clf.fit(X, y)` then `predict_proba(X)` on the same rows ("AUC-ROC drives the tier gate" — of an overfit number). The experiment suite computes a proper held-out AUC (`experiments.py:372-389`) but the *metrics file* doesn't. Any consumer of `xgb_metrics.json` (e.g. a resurrected tier gate) would gate on a memorized score. Fix: report CV-fold out-of-fold AUC (e.g. `cross_val_predict` + `roc_auc_score`).

**F-B2-05 · Training data is circular: synthetic labels are the rules' own output on the same features** — `scripts/expand_dataset.py:84-113` + `experiments.py` suite.
90 days of labels are generated by `score_hour()` over archive weather; models are then trained on those labels and the experiment suite compares model-vs-rules *against rules-derived ground truth*. The rule baseline can never lose by construction on synthetic days, and the LSTM's apparent F1 mostly measures how well it mimics `score_hour`. This is a legitimate bootstrap strategy — but experiment results presented in the UI do not separate `synthetic_rule` from operator labels (the dataset summary has `per_site` counts but no `per_source` breakdown), so readers of the Experiments page can mistake rigged metrics for real skill. Fix: `per_source` split in `dataset_summary`, and a "synthetic-only" flag on experiment runs.

**F-B2-06 · `predict()` uses the N+1 `build_sequence` path — 96 DB queries + 24 pandas DataFrames per forecast hour** — `model.py:249-253` → `features.py:127-145`.
The services layer (Phase 4) correctly uses `build_sequences_for_window` for the 48h dashboard forecast, but `predict()` — the path used by agent tool `get_forecast`, active-learning replay, and any single-time caller — rebuilds the slow path per call. Active learning (`active_learning.py:193-198`) calls it once per day × 7 days per site on **every dashboard render** (the nudge component). Measured pattern from Phase 4: this is what caused 30-50 s page loads before. Fix: route `predict()` through the batched builder for its single window (cheap win), and make `suggest_active_labels` use `build_sequences_for_window` over the 7 target timestamps.

**F-B2-07 · No retrain trigger or drift detection** — the model is loaded once per process (`_cached_bundle`), the calibrator once (`_calibrator_checked`), and nothing monitors label volume, class balance, or feature drift. With an active-learning loop explicitly designed to collect labels, the loop dead-ends: new labels sit in the DB until a human manually runs `python -m scripts.train_model`, and even then the running API keeps serving the *old* bundle until restart (`reload()` exists but nothing calls it automatically post-retrain). Cross-ref: the experiment page has a "run experiments (auto-reloads model)" path — but `train_model` (the actual retrain) has no such hook.

### P2 — Medium

**F-B2-08 · Early-stopping validation inside `train_lstm` is temporally leaked when called from the experiment suite** — `experiments.py:414` calls `train_lstm(X_train_seq, y_train, config)` *without* `label_dates`, so the 85/15 split inside is a random shuffle of contiguous days; adjacent days share 23 of 24 lookback hours (the exact leak the Phase-2 docstring warns about, `model_lstm.py:153-157`). Early stopping/model selection on a leaked val set biases epochs. Fix: pass label dates from the experiment's train block (they're available in `run_full_experiment_suite` via `label_dates[train_idx]`).

**F-B2-09 · Purge is applied at the train/val boundary only, not val/test** — `experiments.py:108-120`. Harmless today because the val block is never used (materialized but unconsumed, `experiments.py:259-268`), but it becomes a leak the moment validation metrics are wired in.

**F-B2-10 · Calibrator winner-selection is evaluated on the same holdout used to fit** — `calibration.py:143-168` and `train_calibrator.py:199-204`. The winning calibrator's Brier is optimistically biased (winner's curse); with n<100 holdouts this can flip the Platt-vs-isotonic choice. scikit-learn's guidance is to calibrate on data distinct from both training and final evaluation ([scikit-learn calibration guide](https://scikit-learn.org)). Fix: split the holdout into calibrate/report halves, or use CV.

**F-B2-11 · Replay-hour inconsistency between training (12:00 UTC ≈ 20:00 local) and calibrator rules path (00:00 UTC naive ≈ 08:00 local)** — `train_model.py:62-65` / `active_learning.py:148` vs `train_calibrator.py:69` (`datetime.combine(...min.time())`, no tz). Features for a "day" differ by 12 h depending on which script builds them; the calibrator's source probabilities therefore come from a different feature window than production's.

**F-B2-12 · `_load_training_data` type annotation says 4-tuple, returns 5-tuple** — `train_model.py:33-95`. Also catches bare `except Exception` around per-label feature building, silently shrinking the dataset (only a count is printed).

**F-B2-13 · Ablation "all_11" name is stale — it now trains on all 14 features** — `experiments.py:534-552`; the "weather_only_7" slice `[:, :, :7]` is still correct only because the weather features happen to be first. Brittle to any FEATURE_COLUMNS reordering; should slice by column names.

**F-B2-14 · `torch.load(..., weights_only=False)` unpickles arbitrary objects** — `model_lstm.py:420`. Standard for PyTorch but means a tampered `seasid_lstm.pt` = code execution on the server. Acceptable for a single-tenant academic deploy; worth a SECURITY.md note (artifact files live in the same writable data dir as the SQLite DB).

**F-B2-15 · `pos_weight` computed over train+val labels** — `model_lstm.py:241-250` (uses full `y`), minor leakage consistent with F-B2-03.

### P3 — Low

**F-B2-16 · `binary_entropy` duplicates information already implied by the band filter** — `active_learning.py:85-97`; entropy sort within a fixed band is near-constant ordering by distance from 0.5. Harmless.
**F-B2-17 · `active_learning_summary()` recomputes full suggestion lists just to count them** — `active_learning.py:237-255`; a lighter count-only query would do.
**F-B2-18 · `LSTMPredictor` default `input_size=11` vs 14 live features** — `model_lstm.py:42`; saved `feature_columns` makes load-time sizing correct, but the default invites silent mismatch in ad-hoc use.
**F-B2-19 · Experiment results JSON written non-atomically** — `experiments.py:345-346`; a crash mid-write corrupts the file the UI serves. Write-temp-then-rename.

---

## 4. Web research (what current best practice says)

1. **Model choice at this sample size.** The literature is unambiguous: gradient-boosted trees beat deep nets on small/medium tabular data, and small-sample deep learning needs heavy regularization or hybrid designs. SeaSID's own Phase-0/2 history (LSTM collapse to 0.5 at 78 samples) matches this. Sources: [Shwartz-Ziv & Armon, *Tabular Data: Deep Learning is Not All You Need*] · [Jiang et al. 2020, Boosting tree-assisted DL for small sample sizes (PMC)](https://pmc.ncbi.nlm.nih.gov) · [Data Cowboys small-data benchmark — LightGBM/logistic safest].
2. **Sample-size discipline for safety-relevant prediction models.** Riley et al.'s pmsampsize methodology (and TRIPOD+AI reporting) exists precisely for prediction models that gate real-world decisions; key point: *calibration degrades fastest on new data when trained small*. Directly applicable: SeaSID's LSTM trains on ~104 samples and its output gates dive go/no-go. Sources: [Riley et al. 2020, BMJ — sample size for clinical prediction models](https://pubmed.ncbi.nlm.nih.gov) · TRIPOD+AI statement.
3. **Calibration.** Best practice: calibrate on data disjoint from training *and* final evaluation; Platt for small samples; isotonic ≥ ~200-1000; AUC should be roughly invariant to calibration, so post-calibration AUC "improvements" in the report are a smell (they only move when the calibrator reorders — e.g. the empirical-bin isotonic). Sources: [scikit-learn 1.16 probability calibration guide](https://scikit-learn.org) · [Niculescu-Mizil & Caruana, Cornell](https://www.cs.cornell.edu) · [MLMastery — calibration for imbalanced data](https://www.machinelearningmastery.com).
4. **Walk-forward/time-series validation** — blocked splits with purge/embargo are standard; SeaSID's `_time_aware_split` implements a reasonable 1-day purge; the gap is applying it consistently (findings F-B2-03/08) and embargoing the LSTM's 24h lookback explicitly (purge_days ≥ seq_len/24).

## 5. Gap analysis vs. best practice

| Best practice | SeaSID status | Gap |
|---|---|---|
| Gate deployment of a model on held-out quality | Gate exists in docstring/tests, **not at runtime** | **Major** (P0) |
| Consistent target definition across train/calibrate | `poor_viz` = no-go in training, go in calibrator | **Major** (P0) |
| Scaler/metrics fit on train only | Fit on full dataset; metrics in-sample | Major (P1) |
| Out-of-fold metrics for the baseline | In-sample AUC persisted | Major (P1) |
| Label provenance surfaced in evaluation | `per_site` yes, `per_source` no | Partial (P1) |
| Batch feature building everywhere | Batched builder exists; `predict()` + active learning bypass it | Partial (P1) |
| Continuous retrain/drift loop | Manual scripts; no trigger, no drift metric | Missing (P1) |
| Calibrate on disjoint data | Right idea, selection-on-eval nuance | Partial (P2) |
| Time-aware splits with purge | ✅ Implemented well at suite level; inconsistent callers | Partial |
| Calibrated probabilities for safety decisions | ✅ Phase 7 design (Brier/ECE, persisted, versioned) is genuinely good | Met (modulo F-B2-02) |

## 6. Recommendations (prioritized)

1. **P0 — Reconcile the tier system.** Either re-activate the gates (recommend: fix F-B2-03/04 first so the gate reads honest numbers, then let LSTM re-qualify when it earns ≥500 samples + AUC 0.65) or delete the dead code and docstring and document "LSTM-only by design" in README + health payload. Do not leave both.
2. **P0 — Fix the calibrator target:** replace `1 if l.label == "no_dive" else 0` with `label_to_binary(l.label)` in `train_calibrator.py:61`, then re-run `train_calibrator --use-lstm`.
3. **P1 — Honest metrics:** scaler fit on train only; persisted LSTM metrics computed on the val block; XGBoost out-of-fold AUC via `cross_val_predict`; keep a separate `train_metrics` block for diagnostics.
4. **P1 — Surface label provenance:** add `per_source` (operator vs synthetic_rule) counts and a headline caveat to `experiment_results.json` + Experiments page.
5. **P1 — Kill the N+1 in `predict()`/active learning** by routing through `build_sequences_for_window` (single-window call for `predict`; 7-target call for suggestions).
6. **P1 — Close the retrain loop:** after `train_model`/`train_calibrator` complete, call `model.reload()` via a tiny local HTTP ping to the running API (or add a `/admin/reload-model` call to the scripts); add label-count and class-balance gauges to `/health`.
7. **P2 — Pass `label_dates` into `train_lstm` from the experiment suite; add val/test purge; split calibrate/report holdouts; unify replay hour to one constant (suggest 04:00 UTC = noon local, or make it per-site config).**
8. **P3 — Atomic results writes; fix `all_11` naming; slice ablations by column name; note pickle-artifact trust in SECURITY.md.**

---

### What this stack does well (worth keeping)

- The Phase-2 fixes (logits + `BCEWithLogitsLoss`, `pos_weight`, time-aware splits) show real debugging of genuine failure modes, documented in-line.
- `Calibrator` with Brier/ECE, method fallbacks, and identity degradation is a design many production systems lack.
- `_time_aware_split` with purge + boundary reporting in results JSON is ahead of typical academic practice.
- Active-learning uncertainty banding (ask about the fence, not the extremes) is the right operator-centric design.
- SSE streaming of experiment progress/metrics is a genuinely good operator UX (verified on the frontend in F6).
