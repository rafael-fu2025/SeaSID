import { useEffect, useState, useCallback } from 'react';
import { Check, X } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

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

// Peeking-deck geometry: each card behind the front one is nudged down and
// to the side, rotated a touch, and shrunk so its corner peeks out — the
// angle is what sells the "stack of cards" read.
const stackStyle = (depth) => ({
  transform: `translateX(${depth * 5}px) translateY(${depth * 10}px) rotate(${depth * 3}deg) scale(${1 - depth * 0.05})`,
  opacity: depth === 0 ? 1 : depth === 1 ? 0.7 : 0.45,
  zIndex: 30 - depth * 10,
});

// The front card flings off to the right as the deck advances to the next date.
const EXIT_STYLE = {
  transform: 'translateX(120%) rotate(8deg) scale(0.95)',
  opacity: 0,
  zIndex: 40,
};

const DECK_ANIM_MS = 300;

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
  // Date currently flinging out of the deck (drives the switch animation).
  const [flingingDate, setFlingingDate] = useState(null);

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

  // Fling the front card out, then commit the dismissal so the deck
  // advances to the next date once the exit animation has played.
  const advance = useCallback((date, after) => {
    setFlingingDate(date);
    window.setTimeout(() => {
      setFlingingDate(null);
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(date);
        return next;
      });
      if (after) after();
    }, DECK_ANIM_MS);
  }, []);

  const skip = () => {
    if (!current || flingingDate) return;
    advance(current.date);
  };

  const skipAll = () => {
    if (flingingDate) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      visible.forEach((suggestion) => next.add(suggestion.date));
      return next;
    });
    setOpen(false);
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && (submitting || flingingDate)) return;
    setOpen(nextOpen);
  };

  // Persist dismissal changes so they survive navigation away and back.
  useEffect(() => {
    writeDismissed(dismissed);
  }, [dismissed]);

  const submit = async () => {
    if (!current || flingingDate) return;
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
      // Fling the confirmed card out, then commit the dismissal and
      // re-fetch to keep the queue honest (the /verify call already
      // added it to OperatorVerification).
      advance(current.date, () => {
        if (onVerified) onVerified();
        load();
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!current || visible.length === 0) return null;

  const deckCards = visible.slice(0, 3);
  const remaining = visible.length - (flingingDate ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-lg"
        showCloseButton={!submitting}
        data-testid="active-learning-nudge"
      >
        <DialogHeader>
          <DialogTitle className="text-base">Help the model learn</DialogTitle>
          <DialogDescription className="mt-1.5 max-w-[60ch] text-xs leading-relaxed">
            Confirm what happened on this date. Your answer becomes operator feedback for future forecasts.
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-[7rem] pb-5" data-testid="al-deck">
          {deckCards.map((s, index) => {
            const flinging = s.date === flingingDate;
            const depth = flingingDate && !flinging ? index - 1 : index;
            const isFront = depth === 0 && !flinging;
            return (
              <div
                key={s.date}
                aria-hidden={!isFront}
                style={flinging ? EXIT_STYLE : stackStyle(depth)}
                className={cn(
                  'rounded-md border border-border bg-card p-4 shadow-sm',
                  'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
                  isFront ? 'relative' : 'pointer-events-none absolute inset-x-0 top-0',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {formatDate(s.date)}
                  </p>
                  {isFront && (
                    <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                      {remaining} {remaining === 1 ? 'date' : 'dates'} remaining
                    </Badge>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Model estimate
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                      {(s.p_bad * 100).toFixed(0)}% <span className="text-xs font-normal text-muted-foreground">no-go</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Uncertainty
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
                      {s.uncertainty.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">bits</span>
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="active-learning-verdict"
              className="text-xs font-medium text-foreground"
            >
              What actually happened?
            </label>
            <Select value={verdict} onValueChange={setVerdict} disabled={submitting || Boolean(flingingDate)}>
              <SelectTrigger
                id="active-learning-verdict"
                data-testid="al-verdict"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(verdictLabel).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="active-learning-confidence"
              className="text-xs font-medium text-foreground"
            >
              Confidence
            </label>
            <Select value={confidence} onValueChange={setConfidence} disabled={submitting || Boolean(flingingDate)}>
              <SelectTrigger
                id="active-learning-confidence"
                data-testid="al-confidence"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFIDENCE_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {verdict !== 'dive' && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label
                htmlFor="active-learning-reason"
                className="text-xs font-medium text-foreground"
              >
                Main reason
              </label>
              <Select
                value={noGoReason || undefined}
                onValueChange={setNoGoReason}
                disabled={submitting || Boolean(flingingDate)}
              >
                <SelectTrigger
                  id="active-learning-reason"
                  data-testid="al-no-go-reason"
                  className="w-full"
                >
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {NO_GO_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason.charAt(0).toUpperCase() + reason.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            disabled={submitting || Boolean(flingingDate)}
            data-testid="al-skip-all"
          >
            Skip all
          </Button>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={skip}
              disabled={submitting || Boolean(flingingDate)}
              data-testid="al-skip"
            >
              <X className="size-3.5" />
              <span>Skip</span>
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={submitting || Boolean(flingingDate)}
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