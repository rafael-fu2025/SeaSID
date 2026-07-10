import { useEffect, useState } from 'react';
import { api } from '@/api';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/**
 * Dropdown — backwards-compatible shim around shadcn `Select` so the
 * existing Forecast.jsx (which imports `Dropdown`) keeps working
 * while we migrate it. New code should prefer `SiteSelector`.
 *
 * Props mirror the legacy API:
 *   value, onChange, options: [{ value, label, description? }],
 *   placeholder?, className?, ariaLabel?, id?
 *
 * Behaviour:
 *  - Fetches `/sites` once and uses the registered list if `options`
 *    isn't provided.
 *  - Falls back to a static default (Dauin Muck / Apo Reef) when the
 *    API is offline so the UI never locks up.
 */
const FALLBACK_OPTIONS = [
  { value: 'dauin_muck', label: 'Dauin Muck', description: 'muck' },
  { value: 'apo_reef',   label: 'Apo Reef',   description: 'reef' },
];

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = 'Select site',
  className,
  ariaLabel = 'Select dive site',
  id = 'dropdown',
}) {
  const [fetched, setFetched] = useState(null);

  useEffect(() => {
    if (options) return;
    let cancel = false;
    api.getSites()
      .then((sites) => {
        if (cancel) return;
        setFetched(
          (sites || []).map((s) => ({
            value: s.key,
            label: s.name,
            description: s.type,
          })),
        );
      })
      .catch(() => {
        if (!cancel) setFetched(FALLBACK_OPTIONS);
      });
    return () => { cancel = true; };
  }, [options]);

  const items = options || fetched || FALLBACK_OPTIONS;

  return (
    <Select value={value} onValueChange={(v) => onChange?.(v)}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={className}
        data-testid={id}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-2">
              {opt.description && (
                <span className="inline-block size-1.5 rounded-full bg-foreground/40" />
              )}
              <span>{opt.label}</span>
              {opt.description && (
                <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {opt.description}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
