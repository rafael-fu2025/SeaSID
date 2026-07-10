import { useEffect, useState } from 'react';
import { Sun, Moon, CommandIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useTheme } from '@/theme/ThemeContext';

/**
 * StatusBar — bottom strip of the SeaSID cockpit.
 *
 *  - Shows build version, API health, model currently loaded, and a
 *    live clock.
 *  - Hosts the global ⌘K launch button and the theme toggle.
 *  - 32 px tall, full width, slides in above the resizing handle.
 */
export function StatusBar({ onOpenPalette, apiStatus = 'online', modelInUse = 'LSTM' }) {
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onOpenPalette}
            className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            data-testid="open-palette"
          >
            <CommandIcon className="size-3" />
            <span className="font-mono text-[11px]">⌘K</span>
            <span className="hidden sm:inline">Jump / run</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="above">Open command palette</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-4" />

      <span className="inline-flex items-center gap-1.5" data-testid="status-model">
        <span className="size-1.5 rounded-full bg-reef" aria-hidden />
        <span>Model</span>
        <span className="font-mono text-foreground">{modelInUse}</span>
      </span>

      <Separator orientation="vertical" className="h-4" />

      <span className="inline-flex items-center gap-1.5" data-testid="status-api">
        <span
          aria-hidden
          className={
            'size-1.5 rounded-full ' +
            (apiStatus === 'online'
              ? 'bg-positive shadow-[0_0_0_3px_rgba(108,202,143,0.18)]'
              : 'bg-danger shadow-[0_0_0_3px_rgba(224,114,121,0.18)]')
          }
        />
        <span>API</span>
        <span className="font-mono text-foreground">{apiStatus}</span>
      </span>

      <Separator orientation="vertical" className="h-4" />

      <span className="font-mono">Dumaguete · v3.0.0</span>

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
