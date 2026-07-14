import { Card } from '@/components/ui/card';
import { ProbabilityMeter, RiskBadge } from './RiskBadge';
import { FreshnessBadge } from './FreshnessBadge';
import { cn } from '@/lib/utils';

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

const fmtPeriod = (iso) => {
  const hour = new Date(iso).getHours();
  if (hour < 6) return 'Early morning';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
};

/**
 * ForecastCard — a single hour within the selected forecast horizon.
 *
 * Replaces the legacy plain-CSS `.hour-card` with shadcn's Card
 * primitive. Carries the same information (time, viz, P(no-go), risk)
 * but uses semantic tokens so dark/light themes swap automatically.
 *
 * Optimal cards get a left reef-accent ring via a data attribute so
 * callers can highlight specific hours without touching the card.
 *
 * Accepts an optional ``freshness`` descriptor (roadmap #8) so each
 * hour card can surface the source-data status that produced it.
 */
export default function ForecastCard({ hour, isOptimal = false, freshness }) {
  if (!hour) return null;
  const pBad = Number.isFinite(hour.p_bad) ? hour.p_bad : 0;

  return (
    <Card
      data-testid="forecast-card"
      data-optimal={isOptimal ? 'true' : 'false'}
      className={cn(
        'gap-2 rounded-md border bg-card p-3 transition-colors hover:bg-muted/30',
        isOptimal && 'border-reef/60 ring-1 ring-reef/30',
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-base font-semibold tabular-nums text-foreground">
            {fmtTime(hour.ts)}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {fmtPeriod(hour.ts)}
          </div>
        </div>
        <RiskBadge risk={hour.current_risk} />
      </div>

      <div className="text-xs text-foreground">{hour.viz_label ?? '—'}</div>

      <ProbabilityMeter value={pBad} label="P(no-go)" />

      {freshness && (
        <div className="pt-1">
          <FreshnessBadge descriptor={freshness} />
        </div>
      )}
    </Card>
  );
}
