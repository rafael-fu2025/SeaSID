import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Database,
  InfoIcon,
  KeyRound,
  Moon,
  Palette,
  Sun,
  Users,
  Globe,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { AGENT_TOOLS, schemaToParams } from '@/agent/registry';
import { useAuth } from '@/auth/AuthContext';
import ApiKeysAdmin from '@/components/admin/ApiKeysAdmin';
import UsersAdmin from '@/components/admin/UsersAdmin';
import { SiteSelector } from '@/components/SiteSelector';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/ThemeContext';

const DEFAULT_SITE_KEY = 'seasid.defaultSite';
const TOOLS_ENABLED_KEY = 'seasid.toolsEnabled';
const SETTINGS_TAB_KEY = 'seasid.settings.activeTab';
const ADMIN_TABS = new Set(['users', 'api-keys']);
const SETTINGS_TABS = new Set(['appearance', 'agent', 'users', 'api-keys', 'about']);

function readJSON(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore unavailable storage */
  }
}

function readString(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeString(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore unavailable storage */
  }
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(() => {
    const storedTab = readString(SETTINGS_TAB_KEY, 'appearance');
    return SETTINGS_TABS.has(storedTab) ? storedTab : 'appearance';
  });
  const [sites, setSites] = useState([]);
  const [defaultSite, setDefaultSite] = useState(() => readString(DEFAULT_SITE_KEY, 'dauin_muck'));
  const [toolsEnabled, setToolsEnabled] = useState(() => readJSON(TOOLS_ENABLED_KEY, {}));
  // Merged tool list: start with the static snapshot, then layer in any
  // tools the backend discovered at boot (e.g. MCP-backed `web_search`).
  // Storing both keeps the table populated even if `/api/v1/agent/tools`
  // is briefly unavailable.
  const [liveTools, setLiveTools] = useState(() => ({
    tools: AGENT_TOOLS,
    mcp: { status: 'unknown', server: null, tools: [] },
  }));

  useEffect(() => {
    api.getSites().then(setSites).catch(() => setSites([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getAgentTools()
      .then((payload) => {
        if (cancelled || !payload || !Array.isArray(payload.tools)) return;
        // Start with the static built-ins, then append any server-only
        // tools (e.g. MCP) the backend discovered. We never replace a
        // built-in — first writer wins — so the static descriptions and
        // param docs stay as the canonical source for known tools.
        const byName = new Map(AGENT_TOOLS.map((t) => [t.name, t]));
        for (const tool of payload.tools) {
          if (!tool || !tool.name) continue;
          if (!byName.has(tool.name)) {
            byName.set(tool.name, {
              name: tool.name,
              description: tool.description || '',
              params: schemaToParams(tool.parameters),
              source: tool.source || 'mcp',
            });
          }
        }
        setLiveTools({
          tools: Array.from(byName.values()),
          mcp: payload.mcp || { status: 'unknown', server: null, tools: [] },
        });
      })
      .catch(() => {
        // Silent: the static list is a perfectly good fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => { writeString(SETTINGS_TAB_KEY, activeTab); }, [activeTab]);
  useEffect(() => { writeString(DEFAULT_SITE_KEY, defaultSite); }, [defaultSite]);
  useEffect(() => { writeJSON(TOOLS_ENABLED_KEY, toolsEnabled); }, [toolsEnabled]);

  useEffect(() => {
    if (user && user.role !== 'admin' && ADMIN_TABS.has(activeTab)) {
      setActiveTab('appearance');
    }
  }, [activeTab, user]);

  const fallbackSites = useMemo(() => [
    { value: 'dauin_muck', label: 'Dauin Muck Bays', description: 'muck' },
    { value: 'apo_reef', label: 'Apo Island Reef', description: 'reef' },
  ], []);

  const toggleTool = (name, enabled) => {
    setToolsEnabled((previous) => ({ ...previous, [name]: enabled }));
  };

  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage personal preferences, agent access, users, and provider credentials.
          </p>
        </div>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        data-testid={isAdmin ? 'settings-admin-sections' : undefined}
      >
        <TabsList
          variant="line"
          aria-label="Settings sections"
          className="w-full justify-start overflow-x-auto border-b border-border pb-1"
        >
          <TabsTrigger value="appearance" data-testid="settings-tab-appearance" className="flex-none px-3">
            <Palette className="size-3.5" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="agent" data-testid="settings-tab-agent" className="flex-none px-3">
            <Bot className="size-3.5" />
            Agent
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users" data-testid="settings-tab-users" className="flex-none px-3">
              <Users className="size-3.5" />
              Users
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="api-keys" data-testid="settings-tab-api-keys" className="flex-none px-3">
              <KeyRound className="size-3.5" />
              API keys
            </TabsTrigger>
          )}
          <TabsTrigger value="about" data-testid="settings-tab-about" className="flex-none px-3">
            <InfoIcon className="size-3.5" />
            About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="mt-4">
          <Card data-testid="settings-appearance">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-reef" />
                <CardTitle className="text-base">Appearance</CardTitle>
              </div>
              <CardDescription>
                Choose the dashboard color scheme for this browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Theme</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Dark works well in low light; light improves contrast in bright rooms.
                  </p>
                </div>
                <div
                  role="tablist"
                  aria-label="Color theme"
                  className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-card p-1"
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
        </TabsContent>

        <TabsContent value="agent" className="mt-4">
          <Card data-testid="settings-agent">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-reef" />
                <CardTitle className="text-base">Agent</CardTitle>
              </div>
              <CardDescription>
                Set the default site and control which tools the assistant may call.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Default site</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pre-selected when opening the agent or a forecast panel.
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

              <div className="overflow-hidden rounded-md border border-border" data-testid="settings-tools">
                <div className="flex flex-col gap-2 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Tool access</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Click a tool to view its description and parameters. Disabled tools are omitted from the model tool list.
                    </p>
                  </div>
                  <McpStatusBadge status={liveTools.mcp?.status} server={liveTools.mcp?.server} />
                </div>
                <Accordion
                  type="multiple"
                  className="w-full"
                  data-testid="tools-accordion"
                >
                  {liveTools.tools.map((tool) => {
                    const isEnabled = toolsEnabled[tool.name] !== false;
                    return (
                      <AccordionItem
                        key={tool.name}
                        value={tool.name}
                        data-testid={`tool-row-${tool.name}`}
                      >
                        <AccordionTrigger>
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <code
                                className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs"
                                data-testid={`tool-name-${tool.name}`}
                              >
                                {tool.name}
                              </code>
                              {tool.source === 'mcp' && (
                                <Badge variant="outline" className="gap-1 text-[10px]">
                                  <Globe className="size-2.5" />
                                  MCP
                                </Badge>
                              )}
                              <span
                                className={cn(
                                  'ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:ml-0',
                                )}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                <span className="text-[11px]">
                                  {isEnabled ? 'Enabled' : 'Disabled'}
                                </span>
                                <Switch
                                  checked={isEnabled}
                                  onCheckedChange={(enabled) => toggleTool(tool.name, enabled)}
                                  data-testid={`tool-toggle-${tool.name}`}
                                  aria-label={`Toggle ${tool.name}`}
                                />
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {tool.params.length} parameter{tool.params.length === 1 ? '' : 's'}
                              {tool.description ? ' · ' : ''}
                              {tool.description
                                ? tool.description.length > 120
                                  ? `${tool.description.slice(0, 120).trimEnd()}…`
                                  : tool.description
                                : ''}
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          {tool.description && (
                            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                              {tool.description}
                            </p>
                          )}
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Parameters
                            </p>
                            {tool.params.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No parameters.</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {tool.params.map((parameter) => (
                                  <li
                                    key={parameter.name}
                                    className="flex flex-col gap-0.5 rounded border border-border/60 bg-muted/30 px-2.5 py-1.5"
                                  >
                                    <div className="flex flex-wrap items-baseline gap-2">
                                      <code className="font-mono text-[11px] text-foreground">
                                        {parameter.name}
                                      </code>
                                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        {parameter.type}
                                      </span>
                                      {parameter.required && (
                                        <Badge variant="outline" className="px-1 py-0 text-[9px]">
                                          required
                                        </Badge>
                                      )}
                                    </div>
                                    {parameter.description && (
                                      <p className="text-[11px] text-muted-foreground">
                                        {parameter.description}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersAdmin />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="api-keys" className="mt-4">
            <ApiKeysAdmin />
          </TabsContent>
        )}

        <TabsContent value="about" className="mt-4 space-y-4">
          <ProviderStatus />
          <div className="flex items-start gap-3 rounded-md border border-reef/30 bg-reef/5 p-4">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-reef" />
            <div className="text-sm">
              <p className="font-medium text-foreground">About settings</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Theme, default site, and tool preferences live in this browser. Account
                details are available in your{' '}
                <Link
                  to="/profile"
                  className="font-medium text-reef underline-offset-2 hover:underline"
                  data-testid="settings-profile-link"
                >
                  profile
                </Link>
                . Provider keys and user management are restricted to administrators.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
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

function ProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then((health) => {
        if (!cancelled) {
          setProviders(health.providers || {});
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const providerRoles = [
    { role: 'weather', label: 'Weather', defaultName: 'open_meteo' },
    { role: 'marine', label: 'Marine', defaultName: 'open_meteo' },
    { role: 'air', label: 'Air', defaultName: 'off' },
  ];

  return (
    <Card data-testid="settings-providers">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database className="size-4 text-reef" />
          <CardTitle className="text-base">Data sources</CardTitle>
        </div>
        <CardDescription>Live provider configuration reported by the server.</CardDescription>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {providerRoles.map(({ role, label, defaultName }) => {
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
                      ? 'Not configured. An administrator can add an AQICN key.'
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

function McpStatusBadge({ status, server }) {
  if (!status || status === 'unknown') {
    return null;
  }
  if (status === 'connected') {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
        data-testid="mcp-status-connected"
      >
        <Globe className="size-2.5" />
        {server || 'MCP'} connected
      </Badge>
    );
  }
  if (status === 'unavailable') {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-[10px] text-amber-600 dark:text-amber-400"
        data-testid="mcp-status-unavailable"
      >
        <Globe className="size-2.5" />
        Web MCP unavailable
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[10px] text-muted-foreground"
      data-testid="mcp-status-error"
    >
      <Globe className="size-2.5" />
      Web MCP error
    </Badge>
  );
}
