import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useTheme } from '@/theme/ThemeContext';

/**
 * StatusBar — bottom strip of the SeaSID cockpit.
 *
 *   - Optional mobile drawer triggers (`<lg` only) injected via children
 *   - Foundation University branding on the left
 *   - Live clock on the right with a theme toggle
 *
 * On the user's desktop this stays lean (foundation mark + clock + theme
 * button). On mobile/tablet the drawer trigger buttons appear in front of
 * the metadata so the only persistent chrome is reachable.
 */
export function StatusBar({ children }) {
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

      <span
        className="inline-flex items-center gap-2"
        data-testid="status-foundation"
      >
        <img
          src="/foundation.png"
          alt=""
          aria-hidden
          className="size-5 shrink-0 rounded-sm object-contain"
        />
        <span className="hidden text-foreground sm:inline">Foundation University | Team Shift V2</span>
      </span>

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
