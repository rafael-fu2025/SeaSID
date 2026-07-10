import { useState, useEffect, useMemo } from 'react';
import {
  Palette, Bot, Database,
  Sun, Moon, Info, Sparkles, InfoIcon,
} from 'lucide-react';
import { api } from '@/api';
import { useTheme } from '@/theme/ThemeContext';
import { AGENT_TOOLS } from '@/agent/registry';
import { SiteSelector } from '@/components/SiteSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Settings — page-level controls for theme + default site + agent tools.
 *
 *  - Appearance: dark / light theme picker (persists via ThemeContext).
 *  - Agent: default site + per-tool enable/disable switches.
 *  - Tools reference: full table of every tool the agent can call.
 *  - Data sources: live provider status (open_meteo / stormglass / aqicn).
 */
const DEFAULT_SITE_KEY  = 'seasid.defaultSite';
const TOOLS_ENABLED_KEY = 'seasid.toolsEnabled';

function readJSON(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function readString(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function writeString(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [sites, setSites] = useState([]);
  const [defaultSite, setDefaultSite] = useState(() => readString(DEFAULT_SITE_KEY, 'dauin_muck'));
  const [toolsEnabled, setToolsEnabled] = useState(() => readJSON(TOOLS_ENABLED_KEY, {}));

  useEffect(() => {
    api.getSites().then(setSites).catch(() => setSites([]));
  }, []);

  useEffect(() => { writeString(DEFAULT_SITE_KEY, defaultSite); }, [defaultSite]);
  useEffect(() => { writeJSON(TOOLS_ENABLED_KEY, toolsEnabled); }, [toolsEnabled]);

  const fallbackSites = useMemo(() => [
    { value: 'dauin_muck', label: 'Dauin Muck Bays', description: 'muck' },
    { value: 'apo_reef',   label: 'Apo Island Reef', description: 'reef' },
  ], []);

  const toggleTool = (name, enabled) => {
    setToolsEnabled((prev) => ({ ...prev, [name]: enabled }));
  };

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personalize the dashboard, change the default site, and inspect every agent tool.
          </p>
        </div>
      </header>

      {/* Live data sources */}
      <ProviderStatus />

      {/* Appearance */}
      <Card data-testid="settings-appearance">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="size-4 text-reef" />
            <CardTitle className="text-base">Appearance</CardTitle>
          </div>
          <CardDescription>
            Stored in <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px]">localStorage</code> under{' '}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px]">seasid.theme</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick the color scheme. Default is <strong className="text-foreground">dark</strong>;
                switch to light for higher contrast in bright rooms.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Color theme"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1"
            >
              <ThemeTab
                active={theme === 'light'}
                onClick={() => setTheme('light')}
                testid="theme-light"
                Icon={Sun}
                label="Light"
              />
              <ThemeTab
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
                testid="theme-dark"
                Icon={Moon}
                label="Dark"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent */}
      <Card data-testid="settings-agent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-reef" />
            <CardTitle className="text-base">Agent</CardTitle>
          </div>
          <CardDescription>
            Default site and per-tool enable/disable.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Default site</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pre-selected site when opening the agent or any forecast panel.
              </p>
            </div>
            <div className="min-w-[220px]">
              <SiteSelector
                providedSites={fallbackSites}
                value={defaultSite}
                onChange={setDefaultSite}
                id="default-site"
                ariaLabel="Default site"
              />
              {sites.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Server has {sites.length} site{sites.length === 1 ? '' : 's'} registered.
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Tools</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Toggle off any tool the agent should never call. Disabled tools remain
              listed below for reference but are omitted from the model's
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px]"> tool_choice</code> list.
            </p>
            <ul className="mt-4 flex flex-col divide-y divide-border rounded-md border border-border">
              {AGENT_TOOLS.map((t) => {
                const isOn = toolsEnabled[t.name] !== false;
                return (
                  <li key={t.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Sparkles className="size-3.5 shrink-0 text-reef" />
                      <span className="truncate font-mono text-xs">{t.name}</span>
                    </div>
                    <Switch
                      checked={isOn}
                      onCheckedChange={(v) => toggleTool(t.name, v)}
                      data-testid={`tool-toggle-${t.name}`}
                      aria-label={`Toggle ${t.name}`}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Tools reference */}
      <Card data-testid="settings-tools">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="size-4 text-reef" />
            <CardTitle className="text-base">Agent tools</CardTitle>
          </div>
          <CardDescription>
            Synced from{' '}
            <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px]">
              backend/app/lib/agent_tools.py
            </code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-testid="tools-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">Tool</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[32%]">Parameters</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AGENT_TOOLS.map((tool) => (
                <TableRow key={tool.name}>
                  <TableCell>
                    <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs">
                      {tool.name}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">
                    {tool.description}
                  </TableCell>
                  <TableCell>
                    {tool.params.length === 0 ? (
                      <span className="text-xs text-muted-foreground">none</span>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {tool.params.map((p) => (
                          <li key={p.name}>
                            <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px]">
                              {p.name}
                            </code>
                            <span className="ml-1.5 text-[11px] text-muted-foreground">
                              {p.type}{p.required ? ' · required' : ''}
                            </span>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {p.description}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-md border border-reef/30 bg-reef/5 p-4">
        <InfoIcon className="mt-0.5 size-4 text-reef" />
        <div className="text-sm">
          <p className="font-medium text-foreground">About settings</p>
          <p className="mt-1 text-xs text-muted-foreground">
            These preferences live in your browser only. There is no server-side user profile in v3.
          </p>
        </div>
      </div>
    </div>
  );
}

function ThemeTab({ active, onClick, Icon, label, testid }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        'inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-reef text-reef-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}

/**
 * ProviderStatus — live providers reported by /api/v1/health.
 * "Air" only appears when SEASID_PROVIDER_AIR is set to a real provider.
 */
function ProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    api.health()
      .then((h) => { if (!cancel) { setProviders(h.providers || {}); setLoaded(true); } })
      .catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);

  const ROLES = [
    { role: 'weather', label: 'Weather',  defaultName: 'open_meteo' },
    { role: 'marine',  label: 'Marine',   defaultName: 'open_meteo' },
    { role: 'air',     label: 'Air',      defaultName: 'off' },
  ];

  return (
    <Card data-testid="settings-providers">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database className="size-4 text-reef" />
          <CardTitle className="text-base">Data sources</CardTitle>
        </div>
        <CardDescription>
          Live providers reported by{' '}
          <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px]">/api/v1/health</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {ROLES.map(({ role, label, defaultName }) => {
              const name = providers?.[role] ?? defaultName;
              const isDefault = name === defaultName;
              const isOptional = role === 'air' && name === 'off';
              return (
                <div
                  key={role}
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
                  data-testid={`provider-status-${role}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{name}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {isOptional
                      ? 'Not configured — set AQICN_API_KEY to enable.'
                      : isDefault
                        ? 'Default provider, no key required.'
                        : 'Custom provider active.'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
