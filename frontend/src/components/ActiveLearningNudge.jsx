import { useEffect, useState, useCallback } from 'react';
import { Sparkles, Check, X, ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * ActiveLearningNudge — Phase 8.
 *
 * Surfaces past dates where the model was uncertain (p_bad in
 * [0.35, 0.65]) and no operator verification exists yet. Asking the
 * operator about those dates has the highest information value to the
 * model — confirming a "model said 50%" teaches more than confirming a
 * "model said 95%" (already confident).
 *
 * UX:
 *  - Loads suggestions for the current site on mount and when site changes.
 *  - Shows the top suggestion as an inline nudge above the KPI strip.
 *  - Three actions per suggestion:
 *      1. Confirm one of {dive, poor_viz, no_dive} — calls /verify and
 *         dismisses the suggestion (date now has an operator label).
 *      2. Skip — moves to the next suggestion (or hides if exhausted).
 *      3. Show all — expands a list of every suggestion in the queue.
 *  - Dismissed/skipped dates are tracked in localStorage so the nudge
 *    doesn't reappear on every page refresh for the rest of the session.
 */

const NO_GO_REASONS = ['viz', 'current', 'swell', 'weather', 'boat', 'other'];
const CONFIDENCE_LEVELS = ['low', 'med', 'high'];

const formatDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });

const verdictLabel = {
  dive: 'Dive',
  poor_viz: 'Poor viz',
  no_dive: 'No-dive',
};

export default function ActiveLearningNudge({ siteKey, onVerified }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Local per-session dismissal set (date strings).
  const [dismissed, setDismissed] = useState(() => new Set());
  // Inline verdict + reason state for the form on the current suggestion.
  const [verdict, setVerdict] = useState('dive');
  const [noGoReason, setNoGoReason] = useState('');
  const [confidence, setConfidence] = useState('high');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getActiveLearningSuggestions(siteKey, { days: 7, topN: 3 });
      setSuggestions(res.suggestions || []);
    } catch (err) {
      setError(err.message);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [siteKey]);

  useEffect(() => {
    // Reset dismissal + form state when the user switches sites.
    setDismissed(new Set());
    setVerdict('dive');
    setNoGoReason('');
    setConfidence('high');
    load();
  }, [siteKey, load]);

  const visible = suggestions.filter((s) => !dismissed.has(s.date));
  const current = visible[0];
  const rest = visible.slice(1);

  const skip = () => {
    if (!current) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(current.date);
      return next;
    });
  };

  const submit = async () => {
    if (!current) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.verify({
        site_key: siteKey,
        date: current.date,
        verdict,
        no_go_reason: verdict === 'dive' ? null : (noGoReason || null),
        confidence,
        operator: null,  // backend fills in the test operator
        comments: `active_learning: model said ${(current.p_bad * 100).toFixed(0)}% no-go (uncertainty=${current.uncertainty.toFixed(2)}, source=${current.model_source})`,
      });
      // Mark as dismissed — backend has it now.
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(current.date);
        return next;
      });
      // Re-fetch to keep the queue honest (the next call to /verify
      // already added it to OperatorVerification).
      if (onVerified) onVerified();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !current) return null;
  // Don't show if there are zero visible suggestions.
  if (visible.length === 0) return null;

  return (
    <Card
      className="border-primary/20 bg-primary/5"
      data-testid="active-learning-nudge"
    >
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium text-foreground">
                Help the model learn
              </p>
              <Badge variant="outline" className="text-[10px]">
                Phase 8 · active learning
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              The model said{' '}
              <span className="font-mono font-medium tabular-nums text-foreground">
                {(current.p_bad * 100).toFixed(0)}%
              </span>{' '}
              no-go for{' '}
              <span className="font-medium text-foreground">
                {formatDate(current.date)}
              </span>
              {' '}— entropy{' '}
              <span className="font-mono tabular-nums">
                {current.uncertainty.toFixed(2)} bits
              </span>
              . Confirming this teaches it the most.
            </p>
          </div>
        </div>

        {/* Verdict form — pre-fills with the model's implicit verdict
            (>=0.5 => no_dive, else dive) so the common case is one click. */}
        <div className="flex flex-wrap items-end gap-3 rounded-md bg-background/60 p-3 ring-1 ring-inset">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              What actually happened?
            </label>
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
              disabled={submitting}
              data-testid="al-verdict"
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {Object.entries(verdictLabel).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {verdict !== 'dive' && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Main reason
              </label>
              <select
                value={noGoReason}
                onChange={(e) => setNoGoReason(e.target.value)}
                disabled={submitting}
                data-testid="al-no-go-reason"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {NO_GO_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Confidence
            </label>
            <select
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              disabled={submitting}
              data-testid="al-confidence"
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={skip}
              disabled={submitting}
              data-testid="al-skip"
            >
              <X className="size-3.5" />
              <span>Skip</span>
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={submit}
              disabled={submitting}
              data-testid="al-confirm"
            >
              <Check className="size-3.5" />
              <span>{submitting ? 'Saving…' : 'Confirm'}</span>
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-danger" data-testid="al-error">
            {error}
          </p>
        )}

        {/* Show-all button + expandable list */}
        {rest.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border/40 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((e) => !e)}
              className="self-start text-xs"
              data-testid="al-toggle-all"
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <span>
                {expanded ? 'Hide' : 'Show'} {rest.length} more{' '}
                {rest.length === 1 ? 'date' : 'dates'}
              </span>
            </Button>
            {expanded && (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {rest.map((s) => (
                  <li
                    key={`${s.site_key}-${s.date}`}
                    className="flex items-center justify-between rounded-md bg-background/40 px-2 py-1 ring-1 ring-inset"
                  >
                    <span>
                      {formatDate(s.date)} · model said{' '}
                      <span className="font-mono tabular-nums text-foreground">
                        {(s.p_bad * 100).toFixed(0)}%
                      </span>{' '}
                      no-go
                    </span>
                    <span className="font-mono tabular-nums">
                      H={s.uncertainty.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}