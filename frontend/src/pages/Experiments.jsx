import { useState, useEffect, useRef } from 'react';
import { Play, RefreshCw, AlertTriangle, FlaskConical, BarChart3, Loader2, CheckCircle2, Circle } from 'lucide-react';
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
  // Live progress state for the SSE stream:
  //   runStage — one of: "idle" | "starting" | "loading" | "running" | "complete" | "error"
  //   runLogs  — array of strings, one per "log" SSE event
  //   runSamples — total samples seen in the "running" event
  const [runStage, setRunStage] = useState('idle');
  const [runLogs, setRunLogs] = useState([]);
  const [runSamples, setRunSamples] = useState(null);
  const closeStreamRef = useRef(null);

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

  // Tear down any open SSE stream on unmount.
  useEffect(() => {
    return () => { if (closeStreamRef.current) closeStreamRef.current(); };
  }, []);

  const run = () => {
    setRunning(true);
    setError(null);
    setRunStage('starting');
    setRunLogs([]);
    setRunSamples(null);

    const close = api.runExperimentsStream({
      onStatus: (p) => {
        setRunStage(p.stage);
        if (typeof p.samples === 'number') setRunSamples(p.samples);
      },
      onLog: (line) => {
        setRunLogs((prev) => {
          const next = [...prev, line];
          // Keep the log bounded so a long run doesn't blow up the DOM.
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      },
      onMetric: (m) => {
        // Update the live model_comparison in the results card so the
        // operator sees metrics filling in as each model trains.
        setResults((prev) => {
          const mc = (prev && prev.model_comparison) || {};
          return {
            ...(prev || {}),
            model_comparison: {
              ...mc,
              [m.model]: {
                accuracy: m.accuracy,
                precision: m.precision,
                recall: m.recall,
                f1: m.f1,
                auc_roc: m.auc_roc,
              },
            },
          };
        });
      },
      onDone: (p) => {
        setRunStage('complete');
        if (p.results) {
          setResults(p.results);
        }
        setRunning(false);
        if (closeStreamRef.current) {
          closeStreamRef.current();
          closeStreamRef.current = null;
        }
      },
      onError: (message) => {
        setError(message);
        setRunStage('error');
        setRunning(false);
        if (closeStreamRef.current) {
          closeStreamRef.current();
          closeStreamRef.current = null;
        }
      },
    });
    closeStreamRef.current = close;
  };

  const cancel = () => {
    if (closeStreamRef.current) {
      closeStreamRef.current();
      closeStreamRef.current = null;
    }
    setRunning(false);
    setRunStage('idle');
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
          {running ? (
            <Button
              variant="secondary"
              onClick={cancel}
              data-testid="experiments-cancel"
            >
              <Circle className="size-3.5" />
              <span>Cancel</span>
            </Button>
          ) : (
            <Button
              onClick={run}
              disabled={running || loading}
              data-testid="experiments-run"
            >
              <Play className="size-3.5" />
              <span>Run suite</span>
            </Button>
          )}
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

      {(running || runLogs.length > 0) && (
        <RunProgress
          stage={runStage}
          samples={runSamples}
          logs={runLogs}
        />
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

/**
 * Live progress card shown while / while-recently-after the suite ran.
 *
 * Three pieces of state drive the UI:
 *   - stage:   "starting" | "loading" | "running" | "complete" | "error" | "idle"
 *   - samples: total dataset size once known (used in the loading → running message)
 *   - logs:    array of every "log" SSE event the server has emitted so far
 *
 * The log auto-scrolls to the bottom unless the user has scrolled away
 * from the latest line — that way they can review an earlier step
 * without the log jumping back every time a new line arrives. We track
 * this with a `stickToBottom` ref that flips to false when the user
 * scrolls up and back to true when they reach the bottom again.
 */
function RunProgress({ stage, samples, logs }) {
  const scrollerRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 24;
  };

  useEffect(() => {
    if (stickToBottomRef.current && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [logs.length]);

  const stageLabel = {
    starting: 'Starting…',
    loading: 'Loading dataset…',
    running: samples
      ? `Training on ${samples} samples…`
      : 'Training models…',
    complete: 'Complete',
    error: 'Failed',
    idle: 'Idle',
  }[stage] || stage;

  const StageIcon = stage === 'running' || stage === 'loading' || stage === 'starting'
    ? Loader2
    : stage === 'complete'
      ? CheckCircle2
      : Circle;

  return (
    <Card data-testid="experiments-run-progress">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StageIcon
              className={
                stage === 'running' || stage === 'loading' || stage === 'starting'
                  ? 'size-4 animate-spin text-reef'
                  : stage === 'complete'
                    ? 'size-4 text-emerald-500'
                    : 'size-4 text-muted-foreground'
              }
            />
            <CardTitle className="text-base">Run progress</CardTitle>
          </div>
          <Badge
            variant={stage === 'complete' ? 'default' : stage === 'error' ? 'destructive' : 'secondary'}
            data-testid="experiments-stage"
          >
            {stageLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          data-testid="experiments-run-log"
          className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Waiting for first log line…</p>
          ) : (
            logs.map((line, idx) => (
              <div
                key={idx}
                className={
                  line.trim().startsWith('Training:') || line.trim().startsWith('Evaluating:')
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground'
                }
              >
                {line || '\u00A0'}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
