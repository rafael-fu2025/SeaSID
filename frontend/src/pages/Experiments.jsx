import { useState, useEffect } from 'react';
import { api } from '../api';
import { LabIcon, PlayIcon, AlertIcon, RefreshIcon } from '../components/icons';

const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'auc_roc'];

const fmt = (v) => (v == null ? '—' : Number(v).toFixed(3));

export default function Experiments() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const refresh = () => {
    setLoading(true);
    api.getExperimentResults().then(setResults).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.runExperiments();
      if (res.results) setResults(res.results);
      else refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Experiments</h1>
          <p className="page-subtitle">Model comparison and ablation studies, refreshed from the API</p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn--secondary" onClick={refresh} disabled={loading}>
            {loading ? <span className="spinner" /> : <RefreshIcon size={14} />}
            <span>Reload</span>
          </button>
          <button className="btn btn--primary" onClick={run} disabled={running}>
            {running ? <span className="spinner" /> : <PlayIcon size={14} />}
            <span>{running ? 'Running…' : 'Run experiment suite'}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner--danger">
          <span className="banner__icon"><AlertIcon size={16} /></span>
          <div>
            <div className="banner__title">Experiment failed</div>
            <div className="banner__body">{error}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading results...</div>
      ) : !results?.model_comparison ? (
        <div className="card empty">
          <div className="empty__title">No experiment results yet</div>
          <div>Click <strong>Run experiment suite</strong> to train and compare models.</div>
        </div>
      ) : (
        <>
          {results.dataset && (
            <section className="kpi-strip">
              <KPI label="Total samples" value={results.dataset.total_samples} />
              <KPI label="Train" value={results.dataset.train_size} />
              <KPI label="Validation" value={results.dataset.val_size} />
              <KPI label="Test" value={results.dataset.test_size} sub={`${Math.round(results.dataset.positive_ratio * 100)}% positive`} />
            </section>
          )}

          {results.best_model && (
            <div className="banner banner--positive" style={{ marginBottom: 'var(--space-6)' }}>
              <span className="banner__icon"><LabIcon size={16} /></span>
              <div>
                <div className="banner__title">
                  Best model: <strong>{String(results.best_model).toUpperCase()}</strong>
                </div>
                <div className="banner__body">
                  F1 {fmt(results.model_comparison[results.best_model]?.f1)} ·
                  Accuracy {fmt(results.model_comparison[results.best_model]?.accuracy)} ·
                  AUC {fmt(results.model_comparison[results.best_model]?.auc_roc)}
                </div>
              </div>
            </div>
          )}

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Model comparison</h2>
              <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                Trained on the same train/val/test split
              </span>
            </div>
            <div className="section__body section__body--flush">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      {METRICS.map((m) => (
                        <th key={m} className="num">{m.replace('_', '-').toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(results.model_comparison).map(([name, m]) => (
                      <tr key={name} className={name === results.best_model ? 'table__row-best' : ''}>
                        <td className="label-cell">
                          {name === results.best_model ? '● ' : ''}{name.toUpperCase()}
                        </td>
                        {METRICS.map((metric) => (
                          <td key={metric} className="num">{fmt(m[metric])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {results.ablations && (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Ablations</h2>
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                  One parameter changed at a time
                </span>
              </div>
              <div className="section__body">
                <div className="grid-3">
                  {Object.entries(results.ablations).map(([name, data]) => (
                    <div key={name} className="card card--inset">
                      <div className="card-title" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {name.replace(/_/g, ' ')}
                      </div>
                      <table className="table" style={{ marginTop: 'var(--space-3)' }}>
                        <thead>
                          <tr>
                            <th>Variant</th>
                            <th className="num">F1</th>
                            <th className="num">Acc</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(data).map(([variant, metrics]) => (
                            <tr key={variant}>
                              <td className="mono">{variant}</td>
                              <td className="num">{fmt(metrics.f1)}</td>
                              <td className="num">{fmt(metrics.accuracy)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {results.timestamp && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)', textAlign: 'right' }}>
              Last run: {new Date(results.timestamp).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function KPI({ label, value, sub }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {sub && <span className="kpi__sub">{sub}</span>}
    </div>
  );
}
