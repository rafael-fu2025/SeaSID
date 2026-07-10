/**
 * RiskBadge — short text pill + a small filled dot.
 * Variant decided by `level` (low | moderate | high | unknown).
 */

const NORMALIZE = (() => {
  const cache = new Map();
  return (risk) => {
    if (!risk) return 'unknown';
    const key = String(risk).toLowerCase();
    if (cache.has(key)) return cache.get(key);
    let level = 'unknown';
    if (/(high|critical|extreme)/.test(key)) level = 'high';
    else if (/(moderate|medium|med|mod|warn)/.test(key)) level = 'moderate';
    else if (/(low|calm|good|clear|fine|safe)/.test(key)) level = 'low';
    cache.set(key, level);
    return level;
  };
})();

export function RiskBadge({ risk, label }) {
  const level = NORMALIZE(risk);
  return (
    <span className={`risk-badge risk-badge--${level}`} data-level={level} data-testid="risk-badge">
      <span className="risk-badge__dot" aria-hidden />
      {label ?? risk}
    </span>
  );
}

export function ProbabilityMeter({ value = 0, label = 'No-go probability' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const level = pct >= 60 ? 'high' : pct >= 30 ? 'moderate' : 'low';

  return (
    <div className="prob-meter" data-testid="prob-meter">
      <div className="prob-meter__head">
        <span>{label}</span>
        <span className="prob-meter__value">{pct}%</span>
      </div>
      <div className="prob-meter__track">
        <div
          className={`prob-meter__fill prob-meter__fill--${level}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
