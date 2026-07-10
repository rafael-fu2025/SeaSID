import { useState, useEffect } from 'react';
import { api } from '../api';
import SiteSelector from '../components/SiteSelector';
import { RiskBadge } from '../components/RiskBadge';
import { ClipboardIcon, CheckIcon, XIcon, AlertIcon } from '../components/icons';

const VERDICTS = [
  { value: 'dive',     label: 'Dive',         description: 'Conditions were safe and visibility was good.' },
  { value: 'poor_viz', label: 'Poor visibility', description: 'Visibility was reduced but the trip went ahead.' },
  { value: 'no_dive',  label: 'No dive',      description: 'Conditions were unsafe; the trip was cancelled.' },
];

const today = () => new Date().toISOString().split('T')[0];

const pillClass = (label) => {
  if (label === 'dive') return 'pill pill--positive';
  if (label === 'poor_viz') return 'pill pill--warning';
  if (label === 'no_dive') return 'pill pill--danger';
  return 'pill';
};

export default function Verify() {
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({
    site_key: 'dauin_muck',
    operator: '',
    date: today(),
    verdict: 'dive',
    actual_viz_m: '',
    actual_current: 'Low',
    comments: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [recentLabels, setRecentLabels] = useState([]);

  useEffect(() => {
    api.getSites().then(setSites).catch(console.error);
    api.getLabels('all', 15).then((res) => setRecentLabels(res.labels || [])).catch(console.error);
  }, []);

  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const viz = parseFloat(form.actual_viz_m);
      const payload = {
        ...form,
        actual_viz_m: Number.isFinite(viz) ? viz : null,
      };
      const res = await api.verify(payload);
      setResult(res);
      setForm({
        site_key: form.site_key,
        operator: form.operator,
        date: today(),
        verdict: 'dive',
        actual_viz_m: '',
        actual_current: 'Low',
        comments: '',
      });
      const labels = await api.getLabels('all', 15);
      setRecentLabels(labels.labels || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Operator verification</h1>
          <p className="page-subtitle">
            Submit ground-truth dive observations so the model can improve
          </p>
        </div>
      </header>

      <div className="split">
        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">New observation</h2>
              <p className="section__sub">All fields except comments are required</p>
            </div>
          </div>
          <div className="section__body">
            <form className="fieldset" onSubmit={submit}>
              <div className="grid-2">
                <div className="field">
                  <label className="field__label" htmlFor="verify-site">Site</label>
                  {sites.length > 0 ? (
                    <SiteSelector sites={sites} value={form.site_key} onChange={(v) => set('site_key', v)} id="verify-site" />
                  ) : (
                    <input className="input" disabled value={form.site_key} id="verify-site" />
                  )}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="verify-operator">Operator name (optional)</label>
                  <input
                    id="verify-operator"
                    className="input"
                    type="text"
                    value={form.operator}
                    onChange={(e) => set('operator', e.target.value)}
                    placeholder="e.g. Sea Explorers Dauin"
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label className="field__label" htmlFor="verify-date">Date</label>
                  <input
                    id="verify-date"
                    className="input"
                    type="date"
                    value={form.date}
                    onChange={(e) => set('date', e.target.value)}
                    max={today()}
                    required
                  />
                </div>
                <div className="field">
                  <label className="field__label">Verdict</label>
                  <div className="grid-3" style={{ gap: 'var(--space-2)' }}>
                    {VERDICTS.map((v) => (
                      <label
                        key={v.value}
                        className={`btn btn--secondary ${form.verdict === v.value ? '' : ''}`}
                        style={{
                          cursor: 'pointer',
                          borderColor: form.verdict === v.value ? 'var(--accent)' : undefined,
                          background: form.verdict === v.value ? 'var(--accent-soft)' : undefined,
                          color: form.verdict === v.value ? 'var(--text-primary)' : undefined,
                          padding: 'var(--space-2) var(--space-3)',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 2,
                        }}
                      >
                        <input
                          type="radio"
                          name="verdict"
                          value={v.value}
                          checked={form.verdict === v.value}
                          onChange={() => set('verdict', v.value)}
                          style={{ position: 'absolute', opacity: 0 }}
                        />
                        <strong style={{ fontSize: 'var(--text-sm)' }}>{v.label}</strong>
                        <span className="muted" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.3 }}>{v.description}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label className="field__label" htmlFor="verify-viz">Actual visibility (m)</label>
                  <input
                    id="verify-viz"
                    className="input"
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={form.actual_viz_m}
                    onChange={(e) => set('actual_viz_m', e.target.value)}
                    placeholder="e.g. 12"
                  />
                  <span className="field__hint">0–50 meters. Required for accurate labels.</span>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="verify-current">Actual current</label>
                  <select
                    id="verify-current"
                    className="select"
                    value={form.actual_current}
                    onChange={(e) => set('actual_current', e.target.value)}
                  >
                    <option value="Low">Low</option>
                    <option value="Moderate">Moderate</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="verify-comments">Comments</label>
                <input
                  id="verify-comments"
                  className="input"
                  type="text"
                  value={form.comments}
                  onChange={(e) => set('comments', e.target.value)}
                  placeholder="Anything worth noting for future dives"
                />
              </div>

              {result && (
                <div className="banner banner--positive">
                  <span className="banner__icon"><CheckIcon size={16} /></span>
                  <div>
                    <div className="banner__title">Saved as {result.verdict}</div>
                    <div className="banner__body">{result.message}</div>
                  </div>
                </div>
              )}
              {error && (
                <div className="banner banner--danger">
                  <span className="banner__icon"><XIcon size={16} /></span>
                  <div>
                    <div className="banner__title">Could not save observation</div>
                    <div className="banner__body">{error}</div>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
                {submitting ? <><span className="spinner" /> Submitting…</> : 'Submit observation'}
              </button>
            </form>
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <div>
              <h2 className="section__title">Recent observations</h2>
              <p className="section__sub">Last 15 entries across all sites</p>
            </div>
          </div>
          <div className="section__body section__body--flush">
            {recentLabels.length === 0 ? (
              <div className="empty">
                <ClipboardIcon size={20} />
                <div style={{ marginTop: 'var(--space-3)' }}>No observations yet</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Site</th>
                      <th>Verdict</th>
                      <th className="num">Viz (m)</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLabels.map((lbl, i) => (
                      <tr key={i}>
                        <td className="mono">{lbl.date}</td>
                        <td className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{lbl.site_key || lbl.source?.split('_')[0] || '—'}</td>
                        <td><span className={pillClass(lbl.label)}>{lbl.label}</span></td>
                        <td className="num">{lbl.actual_viz_m ?? '—'}</td>
                        <td className="muted" style={{ fontSize: 'var(--text-xs)' }}>{lbl.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
