import { cva } from 'class-variance-authority';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * FreshnessBadge — small chip that surfaces the freshness status of a
 * single data source ("weather", "marine", "tide", "air") or the
 * aggregate forecast. Roadmap #8 acceptance criterion: a user can
 * answer "how old is this?" / "which source supplied it?" / "what is
 * missing?" from each decision screen.
 *
 * Variants:
 *   live         → positive (green)   · "live · 12m ago"
 *   stale        → warning (amber)    · "stale · 5h ago"
 *   unavailable  → muted (gray)       · "unavailable"
 *
 * Pass either a single ``status`` string or a freshness descriptor object
 * produced by the backend (``{ source, status, age_hours, provider }``).
 */
const freshnessVariants = cva(
  'border-transparent font-mono text-[10px] uppercase tracking-wider',
  {
    variants: {
      status: {
        live: 'bg-positive/15 text-positive border-positive/30',
        stale: 'bg-warning/15 text-warning border-warning/30',
        unavailable: 'bg-muted text-muted-foreground border-border',
      },
    },
    defaultVariants: { status: 'unavailable' },
  },
);

function formatAge(ageHours) {
  if (ageHours == null) return null;
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))}m`;
  if (ageHours < 24) return `${Math.round(ageHours)}h`;
  return `${Math.round(ageHours / 24)}d`;
}

/**
 * Normalise input: a status string, a freshness descriptor object, or
 * undefined. Returns ``{ status, ageHours, provider, source }``.
 */
function normalise(input) {
  if (!input) return { status: 'unavailable' };
  if (typeof input === 'string') return { status: input };
  return {
    status: input.status || 'unavailable',
    ageHours: input.age_hours,
    provider: input.provider,
    source: input.source,
  };
}

export function FreshnessBadge({ status: statusProp, descriptor, className, label, ...props }) {
  const { status, ageHours, source } = normalise(statusProp ?? descriptor);
  const age = formatAge(ageHours);
  const text = label
    || (status === 'live' ? `live${age ? ` · ${age}` : ''}`
    : status === 'stale' ? `stale${age ? ` · ${age}` : ''}`
    : 'unavailable');

  return (
    <Badge
      className={cn(freshnessVariants({ status }), className)}
      data-testid={`freshness-${source ?? 'forecast'}-${status}`}
      data-source={source}
      data-status={status}
      {...props}
    >
      {text}
    </Badge>
  );
}

/**
 * FreshnessStack — a horizontal row of FreshnessBadges for the forecast.
 *
 * Renders one badge per descriptor in ``freshness`` plus an overall
 * ``degraded`` chip when ``degradedReasons`` is non-empty. Designed to
 * sit in a ForecastCard header or a Dashboard provenance strip.
 */
export function FreshnessStack({ freshness = [], degradedReasons = [], className }) {
  const hasDegraded = degradedReasons.length > 0;
  if (!freshness.length && !hasDegraded) return null;
  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="freshness-stack"
    >
      {freshness.map((f) => (
        <FreshnessBadge key={f.source} descriptor={f} />
      ))}
      {hasDegraded && (
        <Badge
          variant="outline"
          className="border-warning/40 bg-warning/10 font-mono text-[10px] uppercase tracking-wider text-warning"
          data-testid="freshness-degraded"
          title={degradedReasons.join(' · ')}
        >
          {degradedReasons.length} degraded
        </Badge>
      )}
    </div>
  );
}

export default FreshnessBadge;