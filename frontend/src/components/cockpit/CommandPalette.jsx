import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Gauge, Waves, Map, FlaskConical, ClipboardCheck, Settings2,
  Bot, RefreshCw, Sun, Moon, ArrowRight,
} from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';

/**
 * CommandPalette — ⌘K overlay that lets the user jump between pages
 * or trigger global commands (refresh data, toggle theme, open agent).
 *
 *  - Listens for ⌘K (mac) / Ctrl+K (other) globally and toggles open.
 *  - Items are static in v3.0; future: query the backend for sites /
 *    alerts so the palette becomes a search surface for everything.
 *
 * Implementation note: kept dumb on purpose — no router context inside
 * this file other than `useNavigate`, so it can be mounted anywhere.
 */
const PAGES = [
  { to: '/',            label: 'Dashboard',   Icon: Gauge,        shortcut: '⌘1' },
  { to: '/forecast',    label: 'Forecast',    Icon: Waves },
  { to: '/map',         label: 'Map',         Icon: Map },
  { to: '/experiments', label: 'Experiments', Icon: FlaskConical },
  { to: '/verify',      label: 'Verify',      Icon: ClipboardCheck },
  { to: '/settings',    label: 'Settings',    Icon: Settings2 },
];

export function CommandPalette({ open, onOpenChange, onToggleTheme }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  // Reset query when opening
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const run = useCallback((fn) => {
    fn?.();
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="SeaSID command palette"
      description="Jump to a page, refresh data, toggle theme."
    >
      <CommandInput
        placeholder="Type a command or page name…"
        value={query}
        onValueChange={setQuery}
        data-testid="palette-input"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Pages">
          {PAGES.map(({ to, label, Icon, shortcut }) => (
            <CommandItem
              key={to}
              value={`page-${label}`}
              onSelect={() => run(() => navigate(to))}
              data-testid={`palette-${label.toLowerCase()}`}
            >
              <Icon className="mr-2 size-4 text-reef" />
              <span>Go to {label}</span>
              {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
              <ArrowRight className="ml-auto size-3 text-muted-foreground" />
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            value="action-refresh"
            onSelect={() => run(() => window.dispatchEvent(new CustomEvent('seasid:refresh')))}
            data-testid="palette-refresh"
          >
            <RefreshCw className="mr-2 size-4 text-reef" />
            <span>Refresh forecast + alerts</span>
            <CommandShortcut>⌘R</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="action-agent"
            onSelect={() => run(() => window.dispatchEvent(new CustomEvent('seasid:open-agent')))}
            data-testid="palette-agent"
          >
            <Bot className="mr-2 size-4 text-reef" />
            <span>Open AI agent</span>
            <CommandShortcut>⌘.</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="action-theme"
            onSelect={() => run(onToggleTheme)}
            data-testid="palette-theme"
          >
            <span className="mr-2 flex size-4 items-center justify-center">
              <Sun className="size-4 text-reef dark:hidden" />
              <Moon className="hidden size-4 text-reef dark:block" />
            </span>
            <span>Toggle theme (light / dark)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
