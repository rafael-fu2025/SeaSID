import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * SiteSelector — shadcn Select wrapper that pulls registered sites from
 * the backend and lets the caller observe the chosen key via onChange.
 *
 *  - Audit F-F3-03: sites outside the signed-in user's scope are hidden —
 *    a site-scoped operator used to be able to select another site and get
 *    a raw 403 from the page.
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
  const { user } = useAuth();
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

  const allSites = providedSites ?? fetched;

  // Scope filter: '*' sees everything; otherwise only listed site keys.
  // No auth context (or a null user) → show all: the server still enforces
  // scope, and tests/standalone renders must not hide every option.
  const scope = user?.site_keys;
  const allowed = !scope || scope.includes('*')
    ? allSites
    : (allSites || []).filter((s) => scope.includes(s.key));

  const sites = allowed;
  if (allSites === null && !error) {
    return <Skeleton className="h-9 w-full" />;
  }
  if (error) {
    return (
      <div className="text-xs text-muted-foreground">Sites API offline</div>
    );
  }
  if (sites && sites.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {providedSites ? 'No sites registered' : 'No sites assigned to your account'}
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
