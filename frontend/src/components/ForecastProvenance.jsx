import { Clock, Cpu, Radio, Sparkles } from 'lucide-react';
import { FreshnessBadge } from './FreshnessBadge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * ForecastProvenance — structured "where did this come from?" panel.
 *
 * Splits the strip into two clearly-labelled sections so users can
 * answer the roadmap #8 questions at a glance:
 *
 *   1. Data sources  — one row per role (weather / marine / air / tide)
 *                      with a small FreshnessBadge for each.
 *   2. Forecast metadata — definition-list grid:
 *      Data as of · Model · Providers · Generated.
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
    return (
      d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' UTC'
    );
  };

  const providerEntries = Object.entries(providers || {});
  const sectionTitleCx = cn(
    'mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
    compact && 'text-[9px]',
  );

  return (
    <div
      className={cn(
        'grid grid-cols-1 rounded-md border border-border bg-card/40 p-3 text-xs text-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]',
        compact && 'p-2 text-[11px]',
        className,
      )}
      data-testid="forecast-provenance"
    >
      {/* ── Data sources ──────────────────────────────────────────────── */}
      <section
        className="min-w-0 md:border-r md:border-border md:pr-4"
        data-testid="provenance-section-sources"
      >
        <h3 className={sectionTitleCx}>
          <Sparkles className="size-3 text-reef" aria-hidden />
          Data sources
        </h3>
        {freshness.length === 0 ? (
          <p className="text-muted-foreground">No source data reported.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
            {freshness.map((f) => (
              <li
                key={f.source}
                className="flex min-w-0 items-center justify-between gap-2 rounded border border-border/70 bg-background/50 px-2 py-1.5"
                data-testid={`provenance-source-${f.source}`}
              >
                <span className="font-medium capitalize text-foreground/80">{f.source}</span>
                <FreshnessBadge descriptor={f} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator className="my-3 md:hidden" />

      {/* ── Forecast metadata ───────────────────────────────────────── */}
      <section
        className="min-w-0 md:pl-4"
        data-testid="provenance-section-metadata"
      >
        <h3 className={sectionTitleCx}>
          <Cpu className="size-3 text-reef" aria-hidden />
          Forecast metadata
        </h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Data as of</dt>
          <dd className="font-mono tabular-nums text-foreground" data-testid="provenance-data-as-of">
            <Clock className="mr-1 inline-block size-3 align-text-bottom text-muted-foreground" aria-hidden />
            {fmtTime(dataAsOf)}
          </dd>

          {modelVersion && (
            <>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono text-foreground break-words" data-testid="provenance-model">
                {modelVersion}
              </dd>
            </>
          )}

          {providerEntries.length > 0 && (
            <>
              <dt className="text-muted-foreground">Providers</dt>
              <dd
                className="font-mono text-foreground"
                data-testid="provenance-providers"
              >
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {providerEntries.map(([role, name]) => (
                    <li key={role} className="flex items-baseline gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {role}
                      </span>
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}

          {generatedAt && generatedAt !== dataAsOf && (
            <>
              <dt className="text-muted-foreground">Generated</dt>
              <dd className="font-mono tabular-nums text-foreground" data-testid="provenance-generated-at">
                {fmtTime(generatedAt)}
              </dd>
            </>
          )}
        </dl>

        {/* Tiny brand badge so the panel still surfaces a "live radio" hint
            without crowding the metadata grid. */}
        {providerEntries.length > 0 && (
          <p
            className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/80"
            data-testid="provenance-radio"
          >
            <Radio className="size-3" aria-hidden />
            Provider layer resolving live
          </p>
        )}
      </section>
    </div>
  );
}

export default ForecastProvenance;
