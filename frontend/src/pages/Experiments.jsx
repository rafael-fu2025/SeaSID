import { useState, useEffect } from 'react';
import { Play, RefreshCw, AlertTriangle, FlaskConical, BarChart3 } from 'lucide-react';
import { api } from '@/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton, SkeletonChart } from '@/components/Skeleton';

const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'auc_roc'];

const fmt = (v) => (v == null ? '—' : Number(v).toFixed(3));

/**
 * Detect "no usable results yet" — an empty object, null, undefined, or
 * a payload that has no model entries under any of the supported keys.
 * Used to switch between the empty-state card and the populated table.
 */
function isEmptyResults(results) {
  if (!results) return true;
  if (Array.isArray(results)) return results.length === 0;
  if (results.models) return !Array.isArray(results.models) || results.models.length === 0;
  if (results.by_model) return Object.keys(results.by_model).length === 0;
  if (results.model_comparison) return Object.keys(results.model_comparison).length === 0;
  return true;
}

/**
 * Experiments — runs the model-compare suite + ablation suite and
 * surfaces metric tables per model.
 *
 *  - Two suites: LSTM, XGBoost, GRU, rule-based.
 *  - Five metrics × 4 models in a single sortable table.
 *  - "Run" button POSTs /api/v1/experiments/run which auto-reloads
 *    the active model on the backend.
 *  - Listens for the global `seasid:refresh` event for parity with
 *    other cockpit pages.
 */
export default function Experiments() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    api.getExperimentResults()
      .then(setResults)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener('seasid:refresh', onRefresh);
    return () => window.removeEventListener('seasid:refresh', onRefresh);
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.runExperiments();
      if (res?.results) setResults(res.results);
      else refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Experiments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            4 models · 5 metrics · LeaveOneOut CV
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={refresh}
            disabled={loading || running}
            data-testid="experiments-refresh"
          >
            <RefreshCw className="size-3.5" />
            <span>Refresh</span>
          </Button>
          <Button
            onClick={run}
            disabled={running || loading}
            data-testid="experiments-run"
          >
            {running ? (
              <Skeleton className="size-3.5 rounded-full" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span>{running ? 'Running…' : 'Run suite'}</span>
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-danger" />
            <div className="text-sm">
              <p className="font-medium text-danger">Experiment suite failed</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !results ? (
        <SkeletonChart />
      ) : !results || isEmptyResults(results) ? (
        <EmptyResults onRun={run} running={running} />
      ) : (
        <ResultsCard results={results} />
      )}
    </div>
  );
}

function EmptyResults({ onRun, running }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FlaskConical className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No experiment results yet</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Run the suite to compare LSTM, XGBoost, GRU, and the rule-based baseline.
            This trains all four models and stores the results.
          </p>
        </div>
        <Button onClick={onRun} disabled={running} className="mt-2">
          <Play className="size-3.5" />
          <span>Run suite</span>
        </Button>
      </CardContent>
    </Card>
  );
}

function ResultsCard({ results }) {
  // `results` may be:
  //   { by_model: { lstm: {metric: value}, xgboost: {...}, gru, rule_based }, ... }
  //   { models: [...] }
  //   { model_comparison: { rule, xgb, lstm, gru } }  ← SeaSID's actual shape
  //   or a bare array of rows.
  // We gracefully handle all four so the page keeps working when the
  // backend renames fields.
  let rows = [];
  if (Array.isArray(results.models)) {
    rows = results.models.map((m) => ({ name: m.name, ...m.metrics }));
  } else if (results.by_model) {
    rows = Object.entries(results.by_model).map(([name, metrics]) => ({
      name,
      ...(metrics || {}),
    }));
  } else if (results.model_comparison) {
    // The backend's /api/v1/experiments/results returns the comparison
    // under `model_comparison` with short keys ("xgb", "lstm", "rule",
    // "gru"). Surface the value the user actually wants to read — the
    // held-out test-set metrics — and fall back to the CV metrics
    // inside `train_metrics` if a model is missing top-level fields
    // (e.g. a freshly-retrained LSTM before its eval pass completes).
    rows = Object.entries(results.model_comparison).map(([name, metrics]) => {
      const m = metrics || {};
      const cv = m.train_metrics || {};
      return {
        name,
        accuracy: m.accuracy ?? cv.cv_accuracy,
        precision: m.precision ?? cv.cv_precision,
        recall: m.recall ?? cv.cv_recall,
        f1: m.f1 ?? cv.cv_f1,
        auc_roc: m.auc_roc ?? cv.auc_roc,
      };
    });
  } else if (Array.isArray(results)) {
    rows = results;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-reef" />
          <CardTitle className="text-base">Model comparison</CardTitle>
        </div>
        <CardDescription>
          Each row is a model; each column a metric from LeaveOneOut cross-validation.
          {results.best_model && (
            <>
              {' '}Current best: <span className="font-mono text-foreground">{results.best_model}</span>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table data-testid="experiments-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Model</TableHead>
              {METRICS.map((m) => (
                <TableHead key={m} className="font-mono text-xs uppercase tracking-wider">
                  {m}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={METRICS.length + 1} className="text-center text-muted-foreground">
                  No rows.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const isBest = results.best_model && r.name === results.best_model;
                return (
                  <TableRow
                    key={r.name}
                    data-testid={`experiments-row-${r.name}`}
                    className={isBest ? 'bg-reef/5' : undefined}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={isBest ? 'default' : 'secondary'}
                          className="font-mono text-[10px]"
                        >
                          {r.name}
                        </Badge>
                        {isBest && (
                          <span className="text-[10px] uppercase tracking-wider text-reef">
                            best
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {METRICS.map((m) => (
                      <TableCell key={m} className="font-mono tabular-nums">
                        {fmt(r[m])}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
