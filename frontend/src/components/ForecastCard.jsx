import { ProbabilityMeter } from './RiskBadge';

const levelFor = (p) => (p >= 0.6 ? 'high' : p >= 0.3 ? 'moderate' : 'low');
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export default function ForecastCard({ hour }) {
  if (!hour) return null;
  const p = Number.isFinite(hour.p_bad) ? hour.p_bad : 0;
  const level = levelFor(p);

  return (
    <article className="hour-card" id={`forecast-${hour.ts}`} data-risk-level={level}>
      <header className="hour-card__time">
        <strong>{fmtTime(hour.ts)}</strong>
        <span>{new Date(hour.ts).toLocaleDateString([], { weekday: 'short' })}</span>
      </header>

      <div data-testid="hour-p-bad">
        <span className={`hour-card__p hour-card__p--${level} num`}>
          {Math.round(p * 100)}%
        </span>
      </div>

      <div className="hour-card__meta">
        <div>
          <div className="hour-card__meta-label">Visibility</div>
          <div className="hour-card__meta-value">{hour.viz_label}</div>
        </div>
        <div>
          <div className="hour-card__meta-label">Current</div>
          <div className="hour-card__meta-value">{hour.current_risk}</div>
        </div>
      </div>

      <ProbabilityMeter value={p} label="P(no-go)" />
    </article>
  );
}
