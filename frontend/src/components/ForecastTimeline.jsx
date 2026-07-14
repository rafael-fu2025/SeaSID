import { CalendarDays, Sparkles } from 'lucide-react';
import ForecastCard from '@/components/ForecastCard';
import { Badge } from '@/components/ui/badge';

const dateKey = (iso) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const startOfLocalDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const relativeDayLabel = (date) => {
  const today = startOfLocalDay(new Date());
  const target = startOfLocalDay(date);
  const days = Math.round((target - today) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'long' });
};

const fullDate = (date) =>
  date.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

const time = (iso) =>
  new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export function groupForecastHoursByDay(hours = []) {
  const groups = [];
  for (const hour of hours) {
    const key = dateKey(hour.ts);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, date: new Date(hour.ts), hours: [] };
      groups.push(group);
    }
    group.hours.push(hour);
  }
  return groups;
}

export default function ForecastTimeline({ hours = [], optimalIso }) {
  const groups = groupForecastHoursByDay(hours);

  return (
    <div className="flex flex-col gap-5" data-testid="forecast-timeline">
      {groups.map((group) => {
        const best = group.hours.reduce(
          (current, hour) => hour.p_bad < current.p_bad ? hour : current,
          group.hours[0],
        );

        return (
          <section
            key={group.key}
            className="overflow-hidden rounded-lg border border-border bg-card/30"
            aria-label={`${relativeDayLabel(group.date)}, ${fullDate(group.date)}`}
          >
            <header className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-reef/10 text-reef">
                  <CalendarDays className="size-4" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {relativeDayLabel(group.date)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {fullDate(group.date)} · {group.hours.length} hourly updates
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className="w-fit gap-1.5 font-normal">
                <Sparkles className="size-3 text-positive" aria-hidden />
                Best window {time(best.ts)} · {Math.round(best.p_bad * 100)}% no-go
              </Badge>
            </header>

            <div className="overflow-x-auto px-4 py-4 [scrollbar-color:var(--border)_transparent]">
              <div className="flex min-w-max gap-2.5">
                {group.hours.map((hour) => (
                  <div key={hour.ts} className="w-44 shrink-0">
                    <ForecastCard
                      hour={hour}
                      isOptimal={optimalIso === hour.ts}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
