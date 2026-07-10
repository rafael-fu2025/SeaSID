import { cva } from 'class-variance-authority';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * RiskBadge — Semantic risk indicator.
 *
 * Backed by shadcn's `<Badge>` primitive but composes a CVA-defined
 * variant map so the colour automatically follows the risk level:
 *   low      → positive (green)
 *   moderate → warning  (amber)
 *   high     → danger   (red)
 *   unknown  → muted    (gray)
 *
 * Renders the level in upper-case tracking-wider for a "telemetry"
 * feel. Falls back to a muted chip for null/empty risk.
 */
const riskBadgeVariants = cva(
  'border-transparent font-mono text-[10px] uppercase tracking-wider',
  {
    variants: {
      risk: {
        low: 'bg-positive/15 text-positive border-positive/30',
        moderate: 'bg-warning/15 text-warning border-warning/30',
        high: 'bg-danger/15 text-danger border-danger/30',
        unknown: 'bg-muted text-muted-foreground border-border',
      },
    },
    defaultVariants: { risk: 'unknown' },
  },
);

export function RiskBadge({ risk, className, ...props }) {
  // Normalize input: accept uppercase variants and synonyms.
  const r = String(risk || '').toLowerCase();
  const level =
    /(high|critical|extreme)/.test(r) ? 'high' :
    /(moderate|medium|med|mod|warn)/.test(r) ? 'moderate' :
    /(low|calm|good|clear|fine|safe)/.test(r) ? 'low' :
    'unknown';

  return (
    <Badge
      className={cn(riskBadgeVariants({ risk: level }), className)}
      data-testid={`risk-badge-${level}`}
      {...props}
    >
      {level === 'unknown' ? '—' : level}
    </Badge>
  );
}

export function ProbabilityMeter({ value = 0, label = 'No-go probability' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const level = pct >= 60 ? 'high' : pct >= 30 ? 'moderate' : 'low';
  const tone =
    level === 'high' ? 'bg-danger' :
    level === 'moderate' ? 'bg-warning' :
    'bg-positive';

  return (
    <div className="flex flex-col gap-1" data-testid="prob-meter">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-inset">
        <div
          className={cn('h-full transition-all', tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
