import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from 'lucide-react';
import { api } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PROVIDERS = [
  {
    value: 'llm',
    label: 'LLM',
    title: 'LLM provider',
    description: 'OpenAI-compatible agent connection.',
  },
  {
    value: 'stormglass',
    label: 'Stormglass',
    title: 'Stormglass',
    description: 'Marine weather, waves, swell, and currents.',
  },
  {
    value: 'aqicn',
    label: 'AQICN',
    title: 'AQICN',
    description: 'Air-quality observations and particulate data.',
  },
  {
    value: 'tides',
    label: 'WorldTides',
    title: 'WorldTides',
    description: 'Hourly tide-height data.',
  },
];

const PROVIDER_BY_VALUE = Object.fromEntries(PROVIDERS.map((provider) => [provider.value, provider]));

function canonicalProvider(provider) {
  return provider === 'openai' ? 'llm' : provider;
}

export default function ApiKeysAdmin() {
  const [activeProvider, setActiveProvider] = useState('llm');
  const [keys, setKeys] = useState([]);
  const [configs, setConfigs] = useState({});
  const [configDrafts, setConfigDrafts] = useState({ llm: '' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [configSaved, setConfigSaved] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [addingProvider, setAddingProvider] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deletingKeyId, setDeletingKeyId] = useState(null);
  const [revealedValues, setRevealedValues] = useState({});
  const [copiedKeyId, setCopiedKeyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const revealTimers = useRef(new Map());

  async function refresh({ initial = false } = {}) {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await api.listApiKeys();
      const normalizedKeys = (result.keys || []).map((key) => ({
        ...key,
        provider: canonicalProvider(key.provider),
      }));
      setKeys(normalizedKeys);
      setConfigs(result.configs || {});
      setConfigDrafts((previous) => ({
        ...previous,
        llm: result.configs?.llm?.base_url || '',
      }));
    } catch (err) {
      setError(err.message || 'Failed to load provider settings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { refresh({ initial: true }); }, []);

  useEffect(() => () => {
    revealTimers.current.forEach((timer) => window.clearTimeout(timer));
    revealTimers.current.clear();
  }, []);

  const grouped = useMemo(() => {
    const groups = Object.fromEntries(PROVIDERS.map((provider) => [provider.value, []]));
    for (const key of keys) {
      if (groups[key.provider]) groups[key.provider].push(key);
    }
    return groups;
  }, [keys]);

  function hideKey(keyId) {
    const timer = revealTimers.current.get(keyId);
    if (timer) window.clearTimeout(timer);
    revealTimers.current.delete(keyId);
    setRevealedValues((previous) => {
      const next = { ...previous };
      delete next[keyId];
      return next;
    });
    setCopiedKeyId((current) => (current === keyId ? null : current));
  }

  async function revealKey(keyId) {
    setRevealedValues((previous) => ({
      ...previous,
      [keyId]: { loading: true, value: null, error: null },
    }));
    try {
      const result = await api.revealApiKey(keyId);
      setRevealedValues((previous) => ({
        ...previous,
        [keyId]: { loading: false, value: result.value, error: null },
      }));
      const previousTimer = revealTimers.current.get(keyId);
      if (previousTimer) window.clearTimeout(previousTimer);
      revealTimers.current.set(keyId, window.setTimeout(() => hideKey(keyId), 30_000));
    } catch (err) {
      setRevealedValues((previous) => ({
        ...previous,
        [keyId]: {
          loading: false,
          value: null,
          error: err.message || 'Failed to reveal key.',
        },
      }));
    }
  }

  async function copyKey(keyId, value) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(value);
      setCopiedKeyId(keyId);
      window.setTimeout(() => {
        setCopiedKeyId((current) => (current === keyId ? null : current));
      }, 2_000);
    } catch (err) {
      setRevealedValues((previous) => ({
        ...previous,
        [keyId]: {
          ...previous[keyId],
          error: err.message || 'Copy failed. Select the value manually.',
        },
      }));
    }
  }

  async function deleteKey(key) {
    setPendingDelete(key);
  }

  async function confirmDeleteKey() {
    const key = pendingDelete;
    if (!key) return;
    setPendingDelete(null);
    setDeletingKeyId(key.id);
    setError(null);
    try {
      await api.deleteApiKey(key.id);
      hideKey(key.id);
      await refresh();
    } catch (err) {
      setError(err.message || 'Failed to delete key.');
    } finally {
      setDeletingKeyId(null);
    }
  }

  async function saveLlmConfig(event) {
    event.preventDefault();
    setSavingConfig(true);
    setConfigError(null);
    setConfigSaved(false);
    try {
      const result = await api.updateProviderConfig('llm', {
        base_url: configDrafts.llm.trim() || null,
      });
      setConfigs((previous) => ({ ...previous, llm: result.config }));
      setConfigDrafts((previous) => ({
        ...previous,
        llm: result.config?.base_url || '',
      }));
      setConfigSaved(true);
    } catch (err) {
      setConfigError(err.message || 'Failed to save the base URL.');
    } finally {
      setSavingConfig(false);
    }
  }

  return (
    <>
    <Card data-testid="admin-api-keys" aria-busy={loading || refreshing}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-reef" aria-hidden />
            <CardTitle className="text-base">Provider connections</CardTitle>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refresh()}
            disabled={loading || refreshing}
            data-testid="admin-api-keys-refresh"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        <CardDescription>
          Credentials are encrypted in the SeaSID database. Each provider has one
          configuration and can rotate through multiple enabled keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <Tabs value={activeProvider} onValueChange={setActiveProvider}>
          <TabsList className="w-full justify-start overflow-x-auto" aria-label="API key providers">
            {PROVIDERS.map((provider) => (
              <TabsTrigger
                key={provider.value}
                value={provider.value}
                className="flex-none"
                data-testid={`provider-tab-${provider.value}`}
              >
                {provider.label}
                <Badge variant="outline" className="ml-1 px-1.5 text-[10px]">
                  {grouped[provider.value]?.length || 0}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {PROVIDERS.map((provider) => (
            <TabsContent key={provider.value} value={provider.value} className="mt-4">
              {loading ? (
                <ProviderSkeleton />
              ) : (
                <ProviderPanel
                  provider={provider}
                  items={grouped[provider.value] || []}
                  config={configs[provider.value]}
                  configDraft={configDrafts[provider.value] || ''}
                  setConfigDraft={(value) => {
                    setConfigDrafts((previous) => ({
                      ...previous,
                      [provider.value]: value,
                    }));
                    setConfigSaved(false);
                  }}
                  configError={provider.value === 'llm' ? configError : null}
                  configSaved={provider.value === 'llm' && configSaved}
                  savingConfig={provider.value === 'llm' && savingConfig}
                  onSaveConfig={saveLlmConfig}
                  onAdd={() => setAddingProvider(provider.value)}
                  onEdit={setEditing}
                  onDelete={deleteKey}
                  deletingKeyId={deletingKeyId}
                  revealedValues={revealedValues}
                  copiedKeyId={copiedKeyId}
                  onReveal={revealKey}
                  onHide={hideKey}
                  onCopy={copyKey}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      {addingProvider && (
        <KeyDialog
          mode="create"
          provider={addingProvider}
          onClose={() => setAddingProvider(null)}
          onSaved={async () => {
            setAddingProvider(null);
            await refresh();
          }}
        />
      )}
      {editing && (
        <KeyDialog
          mode="update"
          provider={editing.provider}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </Card>
    <ConfirmDialog
      open={Boolean(pendingDelete)}
      onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      title={`Delete ${pendingDelete?.label || `key #${pendingDelete?.id ?? ''}`}?`}
      description="Removing this API key will stop it from being used to contact its provider. The encrypted record is deleted and can't be recovered."
      confirmLabel="Delete key"
      cancelLabel="Cancel"
      tone="danger"
      onConfirm={confirmDeleteKey}
    />
    </>
  );
}

function ProviderSkeleton() {
  return (
    <div
      className="rounded-md border border-border p-4"
      data-testid="admin-api-keys-loading"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="mt-5 space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

function ProviderPanel({
  provider,
  items,
  config,
  configDraft,
  setConfigDraft,
  configError,
  configSaved,
  savingConfig,
  onSaveConfig,
  onAdd,
  onEdit,
  onDelete,
  deletingKeyId,
  revealedValues,
  copiedKeyId,
  onReveal,
  onHide,
  onCopy,
}) {
  const activeCount = items.filter((key) => key.enabled).length;
  return (
    <section
      className="rounded-md border border-border bg-card/40 p-4"
      data-testid="admin-api-keys-section"
      data-provider={provider.value}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{provider.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{provider.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{items.length} key{items.length === 1 ? '' : 's'}</Badge>
          <Badge variant={activeCount ? 'positive' : 'outline'}>{activeCount} active</Badge>
          <Button size="sm" onClick={onAdd} data-testid="admin-api-keys-add">
            <Plus className="size-3.5" aria-hidden />
            Add key
          </Button>
        </div>
      </header>

      {provider.value === 'llm' && (
        <form
          className="mt-4 rounded-md border border-border bg-background p-3"
          onSubmit={onSaveConfig}
          data-testid="llm-provider-config"
        >
          <div className="mb-2 flex items-center gap-2">
            <Server className="size-3.5 text-reef" aria-hidden />
            <Label htmlFor="llm-base-url">Base URL</Label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="llm-base-url"
              type="url"
              value={configDraft}
              onChange={(event) => setConfigDraft(event.target.value)}
              placeholder="https://api.openai.com/v1"
              autoComplete="url"
              data-testid="llm-base-url"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={savingConfig || configDraft === (config?.base_url || '')}
              data-testid="llm-base-url-save"
            >
              {savingConfig ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="size-3.5" aria-hidden />
              )}
              {savingConfig ? 'Saving…' : 'Save URL'}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Leave blank for the OpenAI SDK default. The agent uses this URL for every key below.
          </p>
          {configError && <p className="mt-2 text-xs text-danger" role="alert">{configError}</p>}
          {configSaved && (
            <p
              className="mt-2 flex items-center gap-1 text-xs text-positive"
              data-testid="llm-base-url-saved"
            >
              <Check className="size-3.5" aria-hidden />
              Base URL saved to the database.
            </p>
          )}
        </form>
      )}

      {items.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border px-4 py-8 text-center">
          <KeyRound className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium text-foreground">No keys configured</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a key here; environment API keys are not read by SeaSID.
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((key) => {
            const revealed = revealedValues[key.id];
            const deleting = deletingKeyId === key.id;
            return (
              <li
                key={key.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded border border-border bg-background px-3 py-2"
                data-testid="admin-api-keys-row"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-foreground">
                    {key.label || `Key #${key.id}`}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {key.value_preview}
                    </span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {key.total_uses} use{key.total_uses === 1 ? '' : 's'}
                    {key.last_used_at && (
                      <> · last used {new Date(key.last_used_at).toLocaleString()}</>
                    )}
                  </span>
                  {key.last_error && (
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-amber">
                      <AlertTriangle className="size-3" aria-hidden />
                      {key.last_error}
                    </span>
                  )}
                  {revealed?.value && (
                    <div className="mt-2 flex max-w-2xl items-center gap-2 rounded border border-reef/30 bg-reef/5 p-2">
                      <code
                        className="min-w-0 flex-1 select-all break-all font-mono text-xs text-foreground"
                        data-testid="admin-api-key-revealed-value"
                      >
                        {revealed.value}
                      </code>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onCopy(key.id, revealed.value)}
                        data-testid="admin-api-keys-copy"
                      >
                        {copiedKeyId === key.id ? (
                          <Check className="size-3.5" aria-hidden />
                        ) : (
                          <Copy className="size-3.5" aria-hidden />
                        )}
                        {copiedKeyId === key.id ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  )}
                  {revealed?.error && (
                    <p className="mt-1 text-xs text-danger" role="alert">{revealed.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <Badge variant={key.enabled ? 'positive' : 'outline'}>
                    {key.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revealed?.loading}
                    onClick={() => (revealed?.value ? onHide(key.id) : onReveal(key.id))}
                    data-testid="admin-api-keys-reveal"
                  >
                    {revealed?.loading ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                    ) : revealed?.value ? (
                      <EyeOff className="size-3.5" aria-hidden />
                    ) : (
                      <Eye className="size-3.5" aria-hidden />
                    )}
                    {revealed?.loading ? 'Revealing…' : (revealed?.value ? 'Hide' : 'Reveal')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit key"
                    onClick={() => onEdit(key)}
                    disabled={deleting}
                    data-testid="admin-api-keys-edit"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete key"
                    onClick={() => onDelete(key)}
                    disabled={deleting}
                    data-testid="admin-api-keys-delete"
                  >
                    {deleting ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5 text-danger" aria-hidden />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function KeyDialog({ mode, provider, initial, onClose, onSaved }) {
  const providerMeta = PROVIDER_BY_VALUE[provider] || { title: provider };
  const [label, setLabel] = useState(initial?.label || '');
  const [value, setValue] = useState('');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        await api.createApiKey({
          provider,
          label: label || null,
          value,
          enabled,
        });
      } else {
        const updates = { label: label || null, enabled };
        if (value) updates.value = value;
        await api.updateApiKey(initial.id, updates);
      }
      await onSaved();
    } catch (err) {
      setError(err.message || 'Save failed.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? `Add ${providerMeta.title} key` : 'Edit API key'}</DialogTitle>
          <DialogDescription>
            Stored encrypted in the SeaSID database. Leave the value blank when
            editing to keep the current secret.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit} aria-busy={busy}>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Provider: <strong className="text-foreground">{providerMeta.title}</strong>
          </div>
          <div className="space-y-2">
            <Label htmlFor="key-label">Label (optional)</Label>
            <Input
              id="key-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. primary or backup"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="key-value">
              {mode === 'create' ? 'API key value' : 'New value (optional)'}
            </Label>
            <Input
              id="key-value"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required={mode === 'create'}
              autoComplete="off"
              data-testid="key-value"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              data-testid="key-enabled"
            />
            Enabled
          </label>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} data-testid="api-key-save">
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="size-4" aria-hidden />
              )}
              {busy ? 'Saving…' : (mode === 'create' ? 'Add key' : 'Save changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
