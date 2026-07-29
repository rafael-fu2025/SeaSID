import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind class-name merger.
 *
 * Combines:
 *   clsx  — for conditional class logic ("px-2", { "opacity-50": disabled })
 *   twMerge — for resolving Tailwind conflicts (later class wins).
 *
 * Used by every shadcn-derived component so callers can override defaults
 * via className without writing specificity wars.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Human-friendly label for a backend model_version string.
 *
 * The API sends canonical IDs like "lstm-lstm-24h-v1" (model type + arch +
 * sequence length), "xgboost-v1" or "rule-based-v1". Those are pinned by
 * backend tests and stored in phase reports, so we never rewrite them —
 * we only prettify for display (e.g. the Dashboard "Model in use" KPI):
 *
 *   "lstm-lstm-24h-v1" → "LSTM · 24h · v1"   (arch elided when == type)
 *   "lstm-gru-24h-v1"  → "LSTM (GRU) · 24h · v1"
 *   "xgboost-v1"       → "XGBoost v1"
 *   "rule-based-v1"    → "Rule-based v1"
 *
 * Unrecognized strings pass through unchanged.
 */
export function formatModelVersion(version) {
  if (!version || typeof version !== 'string') return version;

  const lstm = version.match(/^lstm-([a-z0-9]+)-(\d+)h-v(\d+)$/i);
  if (lstm) {
    const [, arch, seqLen, rev] = lstm;
    const name =
      arch.toLowerCase() === 'lstm' ? 'LSTM' : `LSTM (${arch.toUpperCase()})`;
    return `${name} · ${seqLen}h · v${rev}`;
  }

  const xgb = version.match(/^xgboost-v(\d+)$/i);
  if (xgb) return `XGBoost v${xgb[1]}`;

  const rules = version.match(/^rule-based-v(\d+)$/i);
  if (rules) return `Rule-based v${rules[1]}`;

  return version;
}
