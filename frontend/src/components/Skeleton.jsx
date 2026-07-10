import { cn } from '@/lib/utils';
import { Skeleton as ShadcnSkeleton } from '@/components/ui/skeleton';

/**
 * Skeleton — animated shimmering placeholders.
 *
 * Built on shadcn's `<Skeleton />` (a single block with bg-muted +
 * animate-pulse). These wrappers preserve the old classnames so other
 * pages can drop in without churn while they migrate.
 *
 * Usage:
 *   <SkeletonBlock height={92} />
 *   <SkeletonKpiStrip />
 *   <SkeletonForecastGrid />
 */
export function Skeleton({ className = '', style, ...rest }) {
  return (
    <ShadcnSkeleton
      className={cn('rounded-md', className)}
      style={style}
      {...rest}
    />
  );
}

export function SkeletonBlock({ height = 92, className = '' }) {
  return <Skeleton className={className} style={{ height }} />;
}

export function SkeletonCard({ className = '' }) {
  return <Skeleton className={cn('h-[116px]', className)} />;
}

export function SkeletonLine({ width = '100%', size = 'md', className = '' }) {
  const height =
    size === 'sm' ? 'h-2' :
    size === 'lg' ? 'h-5' :
    'h-3';
  return <Skeleton className={cn(height, className)} style={{ width }} />;
}

export function SkeletonKpiStrip({ count = 4 }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
      data-testid="skeleton-kpi-strip"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
        >
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
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
      data-testid="skeleton-forecast-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
        >
          <SkeletonLine width="35%" />
          <SkeletonLine width="60%" size="lg" />
          <SkeletonLine width="100%" size="sm" />
          <SkeletonLine width="80%" size="sm" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 220 }) {
  return (
    <div
      className="rounded-md border border-border bg-card p-4"
      data-testid="skeleton-chart"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonLine width="50%" size="md" />
          <SkeletonLine width="70%" size="sm" />
        </div>
        <SkeletonLine width={120} />
      </div>
      <Skeleton style={{ height }} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="rounded-md border border-border" data-testid="skeleton-table">
      <div className="grid gap-2 p-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, c) => (
          <SkeletonLine key={c} width="60%" size="sm" />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border p-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonLine key={c} width={c === 0 ? '80%' : '50%'} size="sm" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
