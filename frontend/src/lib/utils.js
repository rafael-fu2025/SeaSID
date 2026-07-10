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
