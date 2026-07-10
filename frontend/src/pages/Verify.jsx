import { useState, useEffect, useCallback } from 'react';
import {
  Send, Check, X, AlertTriangle, Calendar,
  Activity, Wind, Droplets, MessageSquare, ClipboardCheck, Plus, RefreshCw,
} from 'lucide-react';
import { api } from '@/api';
import { SiteSelector } from '@/components/SiteSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Verify — operator verification (ground-truth) entry point.
 *
 *   - Page header + a "+ New observation" button that opens a shadcn
 *     `<Dialog>` pop-up with the structured form.
 *   - The recent observations table occupies the rest of the page.
 *   - Submitting POSTs to /api/v1/verify and refreshes the table on
 *     success; the dialog closes when the save lands.
 *
 * The form was previously always-visible inline; the dialog makes the
 * page focus on the read-mostly list and reduces visual noise.
 */
const VERDICTS = [
  { value: 'dive',     label: 'Dive',            description: 'Conditions were safe and visibility was good.',  tone: 'positive' },
  { value: 'poor_viz', label: 'Poor visibility', description: 'Visibility was reduced but the trip went ahead.', tone: 'warning'  },
  { value: 'no_dive',  label: 'No dive',         description: 'Conditions were unsafe; trip was cancelled.',     tone: 'danger'   },
];

const CURRENTS = ['Low', 'Moderate', 'High'];

const today = () => new Date().toISOString().split('T')[0];

const EMPTY_FORM = () => ({
  site_key: 'dauin_muck',
  operator: '',
  date: today(),
  verdict: 'dive',
  actual_viz_m: '',
  actual_current: 'Low',
  comments: '',
});

export default function Verify() {
  const [sites, setSites] = useState([]);
  const [recentLabels, setRecentLabels] = useState([]);
  const [error, setError] = useState(null);

  const [open, setOpen] = useState(false);

  // Pre-fill site_key from the first available site once it loads.
  useEffect(() => {
    api.getSites().then(setSites).catch(console.error);
    api.getLabels('all', 15).then((res) => setRecentLabels(res.labels || [])).catch(console.error);
  }, []);

  const refreshTable = useCallback(() => {
    api.getLabels('all', 15)
      .then((res) => setRecentLabels(res.labels || []))
      .catch(console.error);
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      {/* Header + action */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Operator verification
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit ground-truth dive observations so the model can improve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={refreshTable}
                data-testid="verify-refresh"
              >
                <RefreshCw className="size-3.5" />
                <span>Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reload recent observations</TooltipContent>
          </Tooltip>
          <Button onClick={() => setOpen(true)} data-testid="verify-new">
            <Plus className="size-4" />
            <span>New observation</span>
          </Button>
        </div>
      </header>

      {/* Recent observations — read-mostly list now that the form is a dialog */}
      <section>
        <RecentObservationsTable recentLabels={recentLabels} />
      </section>

      {/* The dialog form */}
      <NewObservationDialog
        open={open}
        onOpenChange={setOpen}
        sites={sites}
        onSubmitted={() => {
          setOpen(false);
          refreshTable();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Dialog                                                                   */
/* -------------------------------------------------------------------------- */

function NewObservationDialog({ open, onOpenChange, sites, onSubmitted }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);

  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));

  const reset = useCallback(() => {
    setForm({ ...EMPTY_FORM(), site_key: sites[0]?.key || 'dauin_muck' });
    setSubmitError(null);
    setSubmitResult(null);
  }, [sites]);

  // Reset the form whenever the dialog re-opens (so the user starts fresh).
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM(), site_key: sites[0]?.key || 'dauin_muck' });
      setSubmitError(null);
      setSubmitResult(null);
    }
  }, [open, sites]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const viz = parseFloat(form.actual_viz_m);
      const payload = {
        ...form,
        actual_viz_m: Number.isFinite(viz) ? viz : null,
      };
      const res = await api.verify(payload);
      setSubmitResult(res);
      // Brief delay so the user sees the success card, then close.
      setTimeout(() => {
        setSubmitting(false);
        onSubmitted?.();
      }, 600);
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-none bg-reef/10 text-reef">
              <ClipboardCheck className="size-4" />
            </div>
            <div>
              <DialogTitle>New observation</DialogTitle>
              <DialogDescription>
                All fields except comments are required.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-5">
          {/* Row 1: Site + Operator */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verify-site" className="text-xs uppercase tracking-wider text-muted-foreground">
                Site
              </Label>
              {sites.length > 0 ? (
                <SiteSelector
                  sites={sites}
                  value={form.site_key}
                  onChange={(v) => set('site_key', v)}
                  id="verify-site"
                  ariaLabel="Site"
                />
              ) : (
                <Input id="verify-site" disabled value={form.site_key} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verify-operator" className="text-xs uppercase tracking-wider text-muted-foreground">
                Operator name <span className="normal-case text-muted-foreground/60">(optional)</span>
              </Label>
              <Input
                id="verify-operator"
                value={form.operator}
                onChange={(e) => set('operator', e.target.value)}
                placeholder="e.g. Sea Explorers Dauin"
              />
            </div>
          </div>

          {/* Row 2: Date + Actual Current */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verify-date" className="text-xs uppercase tracking-wider text-muted-foreground">
                Date
              </Label>
              <Input
                id="verify-date"
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
                max={today()}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verify-current" className="text-xs uppercase tracking-wider text-muted-foreground">
                Actual current
              </Label>
              <Select
                value={form.actual_current}
                onValueChange={(v) => set('actual_current', v)}
              >
                <SelectTrigger id="verify-current">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENTS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Verdict picker */}
          <fieldset className="flex flex-col gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Verdict
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {VERDICTS.map((v) => {
                const selected = form.verdict === v.value;
                const toneRing =
                  v.tone === 'positive' ? 'border-positive/40 bg-positive/10' :
                  v.tone === 'warning'  ? 'border-warning/40 bg-warning/10' :
                  v.tone === 'danger'   ? 'border-danger/40 bg-danger/10' :
                  'border-border';
                return (
                  <label
                    key={v.value}
                    className={cn(
                      'relative flex cursor-pointer flex-col items-start gap-1 rounded-none border p-3 transition-colors',
                      selected
                        ? toneRing
                        : 'border-border bg-card hover:bg-muted/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="verdict"
                      value={v.value}
                      checked={selected}
                      onChange={() => set('verdict', v.value)}
                      className="sr-only"
                    />
                    <span className="text-sm font-medium text-foreground">{v.label}</span>
                    <span className="text-[11px] text-muted-foreground">{v.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Visibility */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verify-viz" className="text-xs uppercase tracking-wider text-muted-foreground">
              Actual visibility (m)
            </Label>
            <Input
              id="verify-viz"
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={form.actual_viz_m}
              onChange={(e) => set('actual_viz_m', e.target.value)}
              placeholder="e.g. 12"
            />
            <p className="text-[11px] text-muted-foreground">0–50 meters.</p>
          </div>

          {/* Comments */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verify-comments" className="text-xs uppercase tracking-wider text-muted-foreground">
              Comments
            </Label>
            <Input
              id="verify-comments"
              value={form.comments}
              onChange={(e) => set('comments', e.target.value)}
              placeholder="Anything worth noting for future dives"
            />
          </div>

          {/* Inline feedback */}
          {submitResult && (
            <div className="flex items-start gap-2 rounded-none border border-positive/30 bg-positive/10 p-3" role="status">
              <Check className="mt-0.5 size-4 text-positive" />
              <div className="text-sm">
                <p className="font-medium text-positive">Saved as {submitResult.verdict}</p>
                <p className="mt-1 text-xs text-muted-foreground">{submitResult.message}</p>
              </div>
            </div>
          )}
          {submitError && (
            <div className="flex items-start gap-2 rounded-none border border-danger/30 bg-danger/10 p-3" role="alert">
              <X className="mt-0.5 size-4 text-danger" />
              <div className="text-sm">
                <p className="font-medium text-danger">Could not save observation</p>
                <p className="mt-1 text-xs text-muted-foreground">{submitError}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              data-testid="verify-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="verify-submit"
            >
              {submitting ? (
                <Skeleton className="size-3.5 rounded-full" />
              ) : (
                <Send className="size-3.5" />
              )}
              <span>{submitting ? 'Submitting…' : 'Submit observation'}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Recent observations                                                       */
/* -------------------------------------------------------------------------- */

function RecentObservationsTable({ recentLabels }) {
  const [refreshing, setRefreshing] = useState(false);

  const reload = () => {
    setRefreshing(true);
    api.getLabels('all', 15)
      .then((res) => setRecentLabels(res.labels || []))
      .finally(() => setRefreshing(false));
  };

  if (recentLabels.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
          <MessageSquare className="mb-2 size-8 text-muted-foreground/40" />
          <p>No observations yet.</p>
          <p className="text-xs">Click <span className="font-medium text-foreground">+ New observation</span> to record the first one.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="size-4 text-reef" />
            Recent observations
          </CardTitle>
          <CardDescription>Last 15 entries across all sites.</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reload}
          disabled={refreshing}
          data-testid="verify-table-refresh"
          aria-label="Refresh table"
        >
          {refreshing
            ? <Skeleton className="size-3.5 rounded-full" />
            : <RefreshCw className="size-3.5" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table data-testid="verify-recent-table">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead className="text-right">Viz (m)</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentLabels.map((lbl, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{lbl.date}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {lbl.site_key || lbl.source?.split('_')[0] || '—'}
                </TableCell>
                <TableCell>
                  <VerdictPill value={lbl.label} />
                </TableCell>
                <TableCell className="font-mono text-right text-xs">
                  {lbl.actual_viz_m ?? '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {lbl.source}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function VerdictPill({ value }) {
  const v = String(value || '').toLowerCase();
  const tone =
    v === 'dive' ? 'positive' :
    v === 'poor_viz' ? 'warning' :
    v === 'no_dive' ? 'danger' :
    'muted';
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono text-[10px] uppercase tracking-wider',
        tone === 'positive' && 'border-positive/40 text-positive',
        tone === 'warning'  && 'border-warning/40 text-warning',
        tone === 'danger'   && 'border-danger/40 text-danger',
        tone === 'muted'    && 'border-border text-muted-foreground',
      )}
    >
      {value}
    </Badge>
  );
}

// (SiteSelector imported at top)
