/**
 * riskLevels — single source of truth for the P(no-go) threshold bands
 * (audit F-F2-05: the 30%/60% cutoffs were duplicated in four components).
 *
 * Tiers:
 *   low       p <  WARN_THRESHOLD   (0.30)  → go
 *   moderate  WARN ≤ p < NO_GO      (0.60)  → caution
 *   high      p ≥ NO_GO_THRESHOLD           → no-go
 */

export const WARN_THRESHOLD = 0.3;
export const NO_GO_THRESHOLD = 0.6;

/** Level name for a probability in [0, 1]. */
export function level(p) {
  if (p == null) return 'unknown';
  if (p >= NO_GO_THRESHOLD) return 'high';
  if (p >= WARN_THRESHOLD) return 'moderate';
  return 'low';
}

/** Chart-friendly level label ("No-Go" / "Caution" / "Go"). */
export function riskLabel(p) {
  if (p == null) return 'Unknown';
  if (p >= NO_GO_THRESHOLD) return 'No-Go';
  if (p >= WARN_THRESHOLD) return 'Caution';
  return 'Go';
}
