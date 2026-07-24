import { useEffect, useState, useCallback } from 'react';
import { Sparkles, Check, X } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Dismissed dates survive remounts and route changes so the dialog does
// not re-appear every time the operator navigates back to the dashboard.
const DISMISSED_STORAGE_KEY = 'seasid.activeLearning.dismissed';

function readDismissed() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissed(dismissed) {
  try {
    window.localStorage.setItem(
      DISMISSED_STORAGE_KEY,
      JSON.stringify(Array.from(dismissed)),
    );
  } catch {
    /* storage unavailable — fall back to in-memory state */
  }
}

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
 *  - Opens an accessible dialog when a new suggestion is available.
 *  - Reviews one date at a time with three actions:
 *      1. Confirm one of {dive, poor_viz, no_dive} — calls /verify and
 *         advances to the next suggestion.
 *      2. Skip — advances without recording a label.
 *      3. Skip all — dismisses the remaining queue across sessions.
 *  - Dismissed dates persist in localStorage so the dialog does not
 *    re-appear after navigating away and back.
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
  const [open, setOpen] = useState(false);
  const [autoOpenedDate, setAutoOpenedDate] = useState(null);
  // Persisted across remounts/navigation via localStorage so the dialog
  // does not re-appear on every visit to the dashboard.
  const [dismissed, setDismissed] = useState(() => readDismissed());
  // Verdict + reason state for the current suggestion in the dialog.
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
    // Reload suggestions when the user switches sites, but keep the
    // persisted dismissal set so already-skipped dates stay hidden.
    setOpen(false);
    setAutoOpenedDate(null);
    load();
  }, [siteKey, load]);

  const visible = suggestions.filter((s) => !dismissed.has(s.date));
  const current = visible[0];

  useEffect(() => {
    if (!current) return;
    setVerdict(current.p_bad >= 0.5 ? 'no_dive' : 'dive');
    setNoGoReason('');
    setConfidence('high');
  }, [current]);

  useEffect(() => {
    if (loading) return;
    if (!current) {
      setOpen(false);
      return;
    }
    if (autoOpenedDate !== current.date) {
      setAutoOpenedDate(current.date);
      setOpen(true);
    }
  }, [autoOpenedDate, current, loading]);

  const skip = () => {
    if (!current) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(current.date);
      return next;
    });
  };

  const skipAll = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      visible.forEach((suggestion) => next.add(suggestion.date));
      return next;
    });
    setOpen(false);
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && submitting) return;
    setOpen(nextOpen);
  };

  // Persist dismissal changes so they survive navigation away and back.
  useEffect(() => {
    writeDismissed(dismissed);
  }, [dismissed]);

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

  if (!current || visible.length === 0) return null;

  const selectClassName = [
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
    'outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ].join(' ');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-lg"
        showCloseButton={!submitting}
        data-testid="active-learning-nudge"
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden
            >
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-base">Help the model learn</DialogTitle>
                <Badge variant="outline" className="text-[10px]">
                  Phase 8 · active learning
                </Badge>
              </div>
              <DialogDescription className="mt-1.5 max-w-[60ch] text-sm leading-relaxed">
                Confirm what happened on this date. Your answer becomes operator feedback for future forecasts.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {formatDate(current.date)}
            </p>
            <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
              {visible.length} {visible.length === 1 ? 'date' : 'dates'} remaining
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Model estimate
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {(current.p_bad * 100).toFixed(0)}% <span className="text-xs font-normal text-muted-foreground">no-go</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Uncertainty
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                {current.uncertainty.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">bits</span>
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="active-learning-verdict"
              className="text-xs font-medium text-foreground"
            >
              What actually happened?
            </label>
            <select
              id="active-learning-verdict"
              value={verdict}
              onChange={(event) => setVerdict(event.target.value)}
              disabled={submitting}
              data-testid="al-verdict"
              className={selectClassName}
            >
              {Object.entries(verdictLabel).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="active-learning-confidence"
              className="text-xs font-medium text-foreground"
            >
              Confidence
            </label>
            <select
              id="active-learning-confidence"
              value={confidence}
              onChange={(event) => setConfidence(event.target.value)}
              disabled={submitting}
              data-testid="al-confidence"
              className={selectClassName}
            >
              {CONFIDENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {verdict !== 'dive' && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label
                htmlFor="active-learning-reason"
                className="text-xs font-medium text-foreground"
              >
                Main reason
              </label>
              <select
                id="active-learning-reason"
                value={noGoReason}
                onChange={(event) => setNoGoReason(event.target.value)}
                disabled={submitting}
                data-testid="al-no-go-reason"
                className={selectClassName}
              >
                <option value="">Choose a reason</option>
                {NO_GO_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason.charAt(0).toUpperCase() + reason.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <p
            className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
            data-testid="al-error"
            role="alert"
          >
            {error}
          </p>
        )}

        <DialogFooter className="mt-1 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={skipAll}
            disabled={submitting}
            data-testid="al-skip-all"
          >
            Skip all
          </Button>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={skip}
              disabled={submitting}
              data-testid="al-skip"
            >
              <X className="size-3.5" />
              <span>Skip</span>
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={submitting}
              data-testid="al-confirm"
            >
              <Check className="size-3.5" />
              <span>{submitting ? 'Saving…' : 'Confirm'}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}