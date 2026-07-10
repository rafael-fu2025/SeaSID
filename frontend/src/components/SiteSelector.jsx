import { useEffect, useState } from 'react';
import { api } from '@/api';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * SiteSelector — shadcn Select wrapper that pulls registered sites from
 * the backend and lets the caller observe the chosen key via onChange.
 *
 *  - Default value is `defaultValue` and falls back to `value` if no
 *    sites are loaded yet.
 *  - Renders a shadcn Skeleton while sites are loading so the page
 *    header doesn't jump.
 *  - When `value` is supplied (controlled), the Select is locked to it.
 */
export function SiteSelector({
  value,
  defaultValue = 'dauin_muck',
  onChange,
  className,
  id = 'site-selector',
  ariaLabel = 'Select dive site',
  sites: providedSites,
}) {
  const [fetched, setFetched] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (providedSites) return;
    let cancel = false;
    api.getSites()
      .then((s) => { if (!cancel) setFetched(s || []); })
      .catch((e) => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, [providedSites]);

  const sites = providedSites ?? fetched;
  if (sites === null && !error) {
    return <Skeleton className="h-9 w-full" />;
  }
  if (error || (sites && sites.length === 0)) {
    return (
      <div className="text-xs text-muted-foreground">
        {error ? 'Sites API offline' : 'No sites registered'}
      </div>
    );
  }

  const controlled = value !== undefined;
  const current = controlled ? value : defaultValue;
  const items = sites;

  return (
    <Select
      value={current}
      onValueChange={(v) => onChange?.(v)}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={className}
        data-testid={id}
      >
        <SelectValue placeholder="Select site" />
      </SelectTrigger>
      <SelectContent>
        {items.map((site) => (
          <SelectItem
            key={site.key}
            value={site.key}
            data-testid={`site-option-${site.key}`}
          >
            <span className="flex items-center gap-2">
              <span className="inline-block size-1.5 rounded-full bg-foreground/40" />
              <span>{site.name}</span>
              <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {site.type}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default SiteSelector;
