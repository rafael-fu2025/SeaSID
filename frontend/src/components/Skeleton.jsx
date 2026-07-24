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

export function SkeletonKpiStrip({ count = 5 }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
      data-testid="skeleton-kpi-strip"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-4"
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
      className="rounded-md border border-border bg-card p-5"
      data-testid="skeleton-chart"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonLine width="40%" size="md" />
          <SkeletonLine width="55%" size="sm" />
        </div>
        <SkeletonLine width={96} />
      </div>
      <Skeleton style={{ height }} />
    </div>
  );
}

export function SkeletonProvenance() {
  return (
    <div
      className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card/40 p-2 text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:gap-0"
      data-testid="skeleton-provenance"
    >
      <div className="md:border-r md:border-border md:pr-4">
        <SkeletonLine width="35%" size="sm" />
        <div className="mt-2 grid grid-cols-2 gap-1.5 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded border border-border/70 bg-background/50 px-2 py-1.5"
            >
              <SkeletonLine width="45%" size="sm" />
              <SkeletonLine width="28%" size="sm" />
            </div>
          ))}
        </div>
      </div>
      <div className="md:pl-4">
        <SkeletonLine width="40%" size="sm" />
        <div className="mt-2 space-y-1.5">
          <SkeletonLine width="55%" size="sm" />
          <SkeletonLine width="65%" size="sm" />
          <SkeletonLine width="70%" size="sm" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonOptimalWindow() {
  return (
    <section data-testid="skeleton-optimal-window">
      <div className="mb-3 space-y-1.5">
        <SkeletonLine width="30%" size="md" />
        <SkeletonLine width="55%" size="sm" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-card p-4"
          >
            <SkeletonLine width="35%" size="sm" />
            <div className="mt-2">
              <SkeletonLine width="60%" size="lg" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SkeletonFooter() {
  return (
    <div className="flex justify-end pt-2" data-testid="skeleton-footer">
      <SkeletonLine width="40%" size="sm" />
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
