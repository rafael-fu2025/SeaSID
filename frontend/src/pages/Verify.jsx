import { useState, useEffect } from 'react';
import {
  ClipboardCheck, Send, Check, X, AlertTriangle, Calendar,
  Activity, Wind, Droplets, MessageSquare,
} from 'lucide-react';
import { api } from '@/api';
import { SiteSelector } from '@/components/SiteSelector';
import { RiskBadge } from '@/components/RiskBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Verify — operator verification (ground-truth) entry point.
 *
 *  - Left column: structured form (site + operator + date + verdict +
 *    viz + current + comments). Inputs use shadcn primitives.
 *  - Right column: last 15 observations across all sites.
 *  - Submit posts to /api/v1/verify and refreshes the table on success.
 */
const VERDICTS = [
  { value: 'dive',     label: 'Dive',            description: 'Conditions were safe and visibility was good.',  tone: 'positive' },
  { value: 'poor_viz', label: 'Poor visibility', description: 'Visibility was reduced but the trip went ahead.', tone: 'warning'  },
  { value: 'no_dive',  label: 'No dive',         description: 'Conditions were unsafe; trip was cancelled.',     tone: 'danger'   },
];

const CURRENTS = ['Low', 'Moderate', 'High'];

const today = () => new Date().toISOString().split('T')[0];

export default function Verify() {
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({
    site_key: 'dauin_muck',
    operator: '',
    date: today(),
    verdict: 'dive',
    actual_viz_m: '',
    actual_current: 'Low',
    comments: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [recentLabels, setRecentLabels] = useState([]);

  useEffect(() => {
    api.getSites().then(setSites).catch(console.error);
    api.getLabels('all', 15).then((res) => setRecentLabels(res.labels || [])).catch(console.error);
  }, []);

  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const viz = parseFloat(form.actual_viz_m);
      const payload = {
        ...form,
        actual_viz_m: Number.isFinite(viz) ? viz : null,
      };
      const res = await api.verify(payload);
      setResult(res);
      setForm({
        site_key: form.site_key,
        operator: form.operator,
        date: today(),
        verdict: 'dive',
        actual_viz_m: '',
        actual_current: 'Low',
        comments: '',
      });
      const labels = await api.getLabels('all', 15);
      setRecentLabels(labels.labels || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-reef text-reef-foreground">
            <ClipboardCheck className="size-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Operator verification
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Submit ground-truth dive observations so the model can improve.
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Form */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="size-4 text-reef" />
              New observation
            </CardTitle>
            <CardDescription>All fields except comments are required.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldShell label="Site" htmlFor="verify-site">
                  <SiteSelector
                    sites={sites}
                    value={form.site_key}
                    onChange={(v) => set('site_key', v)}
                    id="verify-site"
                    ariaLabel="Site"
                  />
                </FieldShell>
                <FieldShell label="Operator name (optional)" htmlFor="verify-operator">
                  <Input
                    id="verify-operator"
                    value={form.operator}
                    onChange={(e) => set('operator', e.target.value)}
                    placeholder="e.g. Sea Explorers Dauin"
                  />
                </FieldShell>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldShell label="Date" htmlFor="verify-date">
                  <Input
                    id="verify-date"
                    type="date"
                    value={form.date}
                    onChange={(e) => set('date', e.target.value)}
                    max={today()}
                    required
                  />
                </FieldShell>
                <FieldShell label="Actual current" htmlFor="verify-current">
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
                </FieldShell>
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
                          'relative flex cursor-pointer flex-col items-start gap-1 rounded-md border p-3 transition-colors',
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

              <FieldShell label="Actual visibility (m)" htmlFor="verify-viz" hint="0–50 meters.">
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
              </FieldShell>

              <FieldShell label="Comments" htmlFor="verify-comments">
                <Input
                  id="verify-comments"
                  value={form.comments}
                  onChange={(e) => set('comments', e.target.value)}
                  placeholder="Anything worth noting for future dives"
                />
              </FieldShell>

              {result && (
                <div className="flex items-start gap-2 rounded-md border border-positive/30 bg-positive/10 p-3">
                  <Check className="mt-0.5 size-4 text-positive" />
                  <div className="text-sm">
                    <p className="font-medium text-positive">Saved as {result.verdict}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{result.message}</p>
                  </div>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3">
                  <X className="mt-0.5 size-4 text-danger" />
                  <div className="text-sm">
                    <p className="font-medium text-danger">Could not save observation</p>
                    <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                  </div>
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full" size="lg">
                {submitting ? (
                  <Skeleton className="size-3.5 rounded-full" />
                ) : (
                  <Send className="size-3.5" />
                )}
                <span>{submitting ? 'Submitting…' : 'Submit observation'}</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Recent labels */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="size-4 text-reef" />
              Recent observations
            </CardTitle>
            <CardDescription>Last 15 entries across all sites.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {recentLabels.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                <ClipboardCheck className="mb-2 size-8 text-muted-foreground/40" />
                <p>No observations yet.</p>
              </div>
            ) : (
              <Table data-testid="verify-recent-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="text-right">Viz (m)</TableHead>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FieldShell({ label, htmlFor, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      {children}
      {hint && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
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
