/**
 * Hand-rolled stroke icon set. 16x16 viewBox, stroke-width 1.5, currentColor
 * fills. Used across the UI in place of emoji-as-icons.
 *
 * Each icon is a tiny pure-functional component, sized via the parent font-size
 * (use 1em on the consumer or pass `size` prop which sets width/height).
 */

const baseProps = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export function GaugeIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M2.5 11a5.5 5.5 0 0 1 11 0" />
      <path d="M8 11l3-3.5" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WaveIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M1 6.5Q3 4.5 5 6.5T9 6.5T13 6.5T15 6.5" />
      <path d="M1 9.5Q3 7.5 5 9.5T9 9.5T13 9.5T15 9.5" />
      <path d="M1 12.5Q3 10.5 5 12.5T9 12.5T13 12.5T15 12.5" />
    </svg>
  );
}

export function WindIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M1 4h9a2 2 0 1 0-2-2" />
      <path d="M1 8h13a2 2 0 1 1-2 2" />
      <path d="M1 12h7" />
    </svg>
  );
}

export function DropIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M8 1.5c-2.5 3-5 5.5-5 8a5 5 0 0 0 10 0c0-2.5-2.5-5-5-8z" />
    </svg>
  );
}

export function EyeIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M1 8s2-4.5 7-4.5S15 8 15 8s-2 4.5-7 4.5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

export function CurrentIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M2 8c2-2 4 2 6 0s4-2 6 0" />
      <path d="M2 11c2-2 4 2 6 0s4-2 6 0" />
      <path d="M14 4l-1.5-1.5M14 4l-1.5 1.5" />
    </svg>
  );
}

export function AlertIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M8 2l6.5 11h-13z" />
      <line x1="8" y1="6.5" x2="8" y2="9.5" />
      <circle cx="8" cy="11.25" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}

export function XIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M5.5 3.5L10 8L5.5 12.5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M3.5 5.5L8 10L12.5 5.5" />
    </svg>
  );
}

export function StarIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M8 1.5l2 4.3l4.5.6l-3.25 3.25l.75 4.65L8 12.1l-4 2.2l.75-4.65L1.5 6.4L6 5.8z" />
    </svg>
  );
}

export function SendIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M1.5 8l13-6l-3 13l-3.5-5z" />
      <line x1="8" y1="10" x2="14.5" y2="2" />
    </svg>
  );
}

export function LabIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M5 1.5h6" />
      <path d="M6 1.5v4L2.5 13a1.5 1.5 0 0 0 1.3 2.25h8.4A1.5 1.5 0 0 0 13.5 13L10 5.5v-4" />
      <line x1="4" y1="9.5" x2="12" y2="9.5" />
    </svg>
  );
}

export function ClipboardIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <rect x="3.5" y="2.5" width="9" height="12" rx="1" />
      <rect x="6" y="1.5" width="4" height="2" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RefreshIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M13.5 7.5a5.5 5.5 0 1 1-1.5-3.7" />
      <path d="M13.5 2v3.5h-3.5" />
    </svg>
  );
}

export function PlayIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M4 3l9 5l-9 5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function InfoIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7" x2="8" y2="11" />
      <circle cx="8" cy="5" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BrainIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M5 2.5a2 2 0 0 0-2 3a2 2 0 0 0-1 3a2 2 0 0 0 1 3a2 2 0 0 0 2 2.5h1V2.5z" />
      <path d="M11 2.5a2 2 0 0 1 2 3a2 2 0 0 1 1 3a2 2 0 0 1-1 3a2 2 0 0 1-2 2.5h-1V2.5z" />
      <path d="M8 5v3M6.5 6.5L8 8M9.5 6.5L8 8M8 8v3" />
    </svg>
  );
}

export function MapIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M1.5 3l4-1.5L9.5 3l4-1.5v11l-4 1.5L5.5 12.5l-4 1.5z" />
      <line x1="5.5" y1="1.5" x2="5.5" y2="12.5" />
      <line x1="9.5" y1="3" x2="9.5" y2="14" />
    </svg>
  );
}

export function SettingsIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M3.5 4.5l1.4 1.4M11.1 12.1l1.4 1.4M1.5 8h2M12.5 8h2M4.9 11.1l-1.4 1.4M12.5 4.9l1.4-1.4" />
    </svg>
  );
}

export function SunIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M3.5 4.5l1.4 1.4M11.1 11.1l1.4 1.4M1.5 8h2M12.5 8h2M4.9 11.1l-1.4 1.4M12.5 4.9l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <path d="M13 10.5A5.5 5.5 0 0 1 5.5 3a5.5 5.5 0 1 0 7.5 7.5z" />
    </svg>
  );
}

export function MenuIcon({ size = 16 }) {
  return (
    <svg {...baseProps(size)}>
      <line x1="2" y1="4.5" x2="14" y2="4.5" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="11.5" x2="14" y2="11.5" />
    </svg>
  );
}
