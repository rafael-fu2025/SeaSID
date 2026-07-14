import { Clock, Cpu, Radio } from 'lucide-react';
import { FreshnessStack } from './FreshnessBadge';
import { cn } from '@/lib/utils';

/**
 * ForecastProvenance — small "where did this come from?" panel that
 * answers the roadmap #8 questions:
 *   • How old is this?            → data_as_of timestamp
 *   • Which source supplied it?   → freshness stack (one badge per role)
 *   • Which model produced it?    → model_version
 *   • Which providers are live?   → providers map
 *
 * Designed to sit at the top of Dashboard, MapPage, briefing, and the
 * Agent-generated recommendations so every screen agrees on the same
 * data timestamp.
 */
export function ForecastProvenance({
  dataAsOf,
  freshness = [],
  providers = {},
  modelVersion,
  generatedAt,
  className,
  compact = false,
}) {
  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' UTC';
  };

  const providerEntries = Object.entries(providers || {});

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-card/40 p-3 text-xs',
        compact && 'gap-1 p-2 text-[11px]',
        className,
      )}
      data-testid="forecast-provenance"
    >
      <FreshnessStack freshness={freshness} />

      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground', compact && 'gap-x-3')}>
        <span className="inline-flex items-center gap-1" data-testid="provenance-data-as-of">
          <Clock className="size-3" aria-hidden />
          <span>
            Data as of <span className="font-mono text-foreground">{fmtTime(dataAsOf)}</span>
          </span>
        </span>

        {modelVersion && (
          <span className="inline-flex items-center gap-1" data-testid="provenance-model">
            <Cpu className="size-3" aria-hidden />
            <span>
              Model <span className="font-mono text-foreground">{modelVersion}</span>
            </span>
          </span>
        )}

        {providerEntries.length > 0 && (
          <span className="inline-flex items-center gap-1" data-testid="provenance-providers">
            <Radio className="size-3" aria-hidden />
            <span>
              Providers{' '}
              <span className="font-mono text-foreground">
                {providerEntries.map(([role, name]) => `${role}:${name}`).join(' · ')}
              </span>
            </span>
          </span>
        )}

        {generatedAt && generatedAt !== dataAsOf && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
            <span>
              Generated <span className="font-mono">{fmtTime(generatedAt)}</span>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

export default ForecastProvenance;