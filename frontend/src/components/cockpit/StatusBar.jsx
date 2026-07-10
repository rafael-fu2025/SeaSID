import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useTheme } from '@/theme/ThemeContext';

/**
 * StatusBar — bottom strip of the SeaSID cockpit.
 *
 *   - `⌘K` palette trigger (left, desktop visible)
 *   - Optional mobile drawer triggers (`<lg` only) injected via children
 *   - Model · API status · build · live clock
 *   - Theme toggle
 *
 * On the user's desktop this stays lean (one row of metadata + theme
 * button). On mobile/tablet the drawer trigger buttons appear in front
 * of the metadata so the only persistent chrome is reachable.
 */
export function StatusBar({ onOpenPalette, onOpenAgent, children }) {
  const { theme, cycleTheme } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const fmtTime = now.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const fmtDate = now.toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  return (
    <div
      role="contentinfo"
      aria-label="Status bar"
      className="flex h-8 items-center gap-2 border-t border-border bg-card px-3 text-xs text-muted-foreground"
    >
      {/* Mobile drawer triggers — `lg:hidden` keeps them off the desktop rail */}
      {children}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onOpenPalette}
            className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            data-testid="open-palette"
          >
            {/* Single "⌘K" affordance — the Lucide Command glyph AND the
                literal ⌘ in the text span both render the same symbol,
                so we keep only the text. Works cross-platform
                (Mac ⌘K / Win-Linux Ctrl K visually identical). */}
            <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground">⌘K</kbd>
            <span className="hidden sm:inline text-foreground/80">Jump / run</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="above">Open command palette</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-4" />

      <span className="hidden items-center gap-1.5 sm:inline-flex" data-testid="status-model">
        <span className="size-1.5 rounded-full bg-reef" aria-hidden />
        <span>Model</span>
        <span className="font-mono text-foreground">LSTM</span>
      </span>

      <Separator orientation="vertical" className="hidden h-4 sm:block" />

      <span className="hidden items-center gap-1.5 sm:inline-flex" data-testid="status-api">
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-positive shadow-[0_0_0_3px_rgba(108,202,143,0.18)]"
        />
        <span>API</span>
        <span className="font-mono text-foreground">online</span>
      </span>

      <Separator orientation="vertical" className="hidden h-4 sm:block" />

      <span className="hidden font-mono md:inline">Dumaguete · v3.0.0</span>

      <div className="flex-1" />

      <span className="font-mono text-foreground" data-testid="status-clock">
        {fmtDate} · {fmtTime}
      </span>

      <Separator orientation="vertical" className="h-4" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={cycleTheme}
            aria-label="Toggle theme"
            data-testid="theme-toggle"
          >
            {theme === 'dark' ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="above">
          Switch to {theme === 'dark' ? 'light' : 'dark'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
