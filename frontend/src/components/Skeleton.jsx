/**
 * Skeleton — animated shimmering placeholders.
 *
 * Usage:
 *   <Skeleton variant="line" width="60%" />
 *   <SkeletonBlock height={92} />
 *   <SkeletonKpiStrip />
 *   <SkeletonRows rows={6} />
 */

export function Skeleton({ variant = 'line', width, height, className = '', style, ...rest }) {
  const variantClass = `skeleton--${variant}`;
  return (
    <div
      className={`skeleton ${variantClass} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden
      {...rest}
    />
  );
}

export function SkeletonBlock({ height = 92, className = '' }) {
  return <Skeleton variant="block" height={height} className={className} />;
}

export function SkeletonCard({ className = '' }) {
  return <Skeleton variant="card" height={116} className={className} />;
}

export function SkeletonLine({ width = '100%', size = 'md', className = '' }) {
  const sz = size === 'sm' ? 'is-sm' : size === 'lg' ? 'is-lg' : '';
  return <Skeleton variant="line" width={width} className={`${sz} ${className}`} />;
}

export function SkeletonKpiStrip({ count = 4 }) {
  return (
    <div className="kpi-strip" data-testid="skeleton-kpi-strip">
      {Array.from({ length: count }).map((_, i) => (
        <div className="kpi" key={i}>
          <SkeletonLine width="40%" size="sm" />
          <SkeletonLine width="70%" size="lg" />
          <SkeletonLine width="50%" size="sm" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonForecastGrid({ count = 12 }) {
  return (
    <div className="forecast-grid" data-testid="skeleton-forecast-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="hour-card" key={i}>
          <SkeletonLine width="35%" />
          <SkeletonLine width="60%" size="lg" />
          <SkeletonLine width="100%" size="sm" />
          <SkeletonLine width="100%" size="sm" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 240 }) {
  return (
    <div className="chart-frame" data-testid="skeleton-chart">
      <div className="chart-frame__head">
        <div>
          <SkeletonLine width="50%" size="md" />
          <SkeletonLine width="70%" size="sm" />
        </div>
        <SkeletonLine width={120} />
      </div>
      <Skeleton variant="block" height={height} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="table-wrap" data-testid="skeleton-table">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, c) => (
              <th key={c}><SkeletonLine width="60%" size="sm" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}><SkeletonLine width={c === 0 ? '80%' : '50%'} size="sm" /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
