/**
 * Icons.jsx — color + icon helpers reused by risk-aware components.
 *
 * Adapted from the `testing` project's Icons.jsx so that
 * `ForecastChart.jsx` (which expects `riskColorClasses(risk)`) keeps
 * working without pulling in `react-bootstrap-icons`.
 *
 * The class names mirror SeaSID's Tailwind v4 design tokens
 * (--positive /* go *\/, --warning /* caution *\/, --danger /* no-go *\/)
 * so the chart styling matches the rest of the dashboard.
 */

export const riskColorClasses = (risk) => {
  switch (risk) {
    case 'Go':
      return {
        text: 'text-positive',
        bg: 'bg-positive/10',
        border: 'border-positive/30',
        dot: 'bg-positive',
        ring: 'ring-positive/40',
      };
    case 'Caution':
      return {
        text: 'text-warning',
        bg: 'bg-warning/10',
        border: 'border-warning/30',
        dot: 'bg-warning',
        ring: 'ring-warning/40',
      };
    case 'No-Go':
      return {
        text: 'text-danger',
        bg: 'bg-danger/10',
        border: 'border-danger/30',
        dot: 'bg-danger',
        ring: 'ring-danger/40',
      };
    default:
      return {
        text: 'text-muted-foreground',
        bg: 'bg-muted',
        border: 'border-border',
        dot: 'bg-muted-foreground',
        ring: 'ring-muted-foreground/40',
      };
  }
};
