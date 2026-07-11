import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/ThemeContext';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { SidebarNav } from './cockpit/SidebarNav';
import { Inspector } from './cockpit/Inspector';
import { StatusBar } from './cockpit/StatusBar';
import { CommandPalette } from './cockpit/CommandPalette';
import { useLayoutPrefs } from './cockpit/useLayoutPrefs';
import { MobileNavDrawer, MobileInspectorDrawer } from './cockpit/MobileDrawers';
import { AgentFab } from './AgentFab';

/**
 * SeaSID v3 cockpit shell.
 *
 *   desktop (≥ 1024 px)               mobile / tablet (< 1024 px)
 *   ────────────────────────          ──────────────────────────────
 *   ┌──────┬─────────┬──────┐         ┌──────────────────────────┐
 *   │ Nav  │ <Outlet>│ Insp.│         │       <Outlet />          │
 *   ├──────┴─────────┴──────┤         ├──────────────────────────┤
 *   │   StatusBar          │         │ StatusBar + drawer btns  │
 *   └─────────────────────┘         └──────────────────────────┘
 *
 * Width strategy (intentional — no drag handles):
 *
 *   Desktop rails are fixed pixel widths (240/64 left, 340/56 right)
 *   driven by the persisted `leftCollapsed` / `rightCollapsed` booleans.
 *   Mobile/tablet: no persistent chrome; StatusBar exposes hamburger
 *   buttons that open `<Sheet>` drawer overlays for nav + inspector.
 *
 * Breakpoint: Tailwind `lg` (1024 px). Below it persistent chrome
 * would starve the canvas; above it, the rails fit comfortably.
 *
 * Persisted state:
 *   `localStorage.seasid.cockpit.leftCollapsed`  (bool)
 *   `localStorage.seasid.cockpit.rightCollapsed` (bool)
 *   Defaults: both false (rails expanded on first visit).
 *   The collapse booleans drive desktop chrome only; on mobile the
 *   drawer takes the available width regardless.
 */
const WIDTH_LEFT_OPEN      = 'w-[240px]';
const WIDTH_LEFT_COLLAPSED = 'w-[64px]';
const WIDTH_RIGHT_OPEN     = 'w-[340px]';
const WIDTH_RIGHT_COLLAPSED = 'w-[56px]';

export default function Layout() {
  const { cycleTheme } = useTheme();
  const {
    leftCollapsed,
    rightCollapsed,
    toggleLeft,
    toggleRight,
    reset,
  } = useLayoutPrefs();
  const isDesktop = useIsDesktop();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    const onOpen = () => setPaletteOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('seasid:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('seasid:open-palette', onOpen);
    };
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openAgent   = useCallback(() => {
    window.dispatchEvent(new CustomEvent('seasid:open-agent'));
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {isDesktop ? (
        <DesktopShell
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          onToggleLeft={toggleLeft}
          onToggleRight={toggleRight}
          resetLayout={reset}
          openPalette={openPalette}
          openAgent={openAgent}
        />
      ) : (
        <MobileShell
          resetLayout={reset}
          openPalette={openPalette}
          openAgent={openAgent}
        />
      )}

      {/* Cross-breakpoint overlays */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onToggleTheme={cycleTheme}
      />
      <AgentFab />
    </div>
  );
}

function DesktopShell({
  leftCollapsed, rightCollapsed,
  onToggleLeft, onToggleRight,
  resetLayout, openPalette, openAgent,
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div
          data-testid="left-rail"
          data-collapsed={leftCollapsed}
          className={cn(
            'hidden h-full shrink-0 overflow-hidden border-r border-border bg-card lg:block',
            'transition-[width] duration-200 ease-out',
            leftCollapsed ? WIDTH_LEFT_COLLAPSED : WIDTH_LEFT_OPEN,
          )}
        >
          <SidebarNav
            collapsed={leftCollapsed}
            onToggle={onToggleLeft}
            onResetLayout={resetLayout}
          />
        </div>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
          <Outlet />
        </main>

        <div
          data-testid="right-rail"
          data-collapsed={rightCollapsed}
          className={cn(
            'hidden h-full shrink-0 overflow-hidden border-l border-border bg-card lg:block',
            'transition-[width] duration-200 ease-out',
            rightCollapsed ? WIDTH_RIGHT_COLLAPSED : WIDTH_RIGHT_OPEN,
          )}
        >
          <Inspector
            siteKey="dauin_muck"
            collapsed={rightCollapsed}
            onToggle={onToggleRight}
          />
        </div>
      </div>

      <StatusBar onOpenPalette={openPalette} onOpenAgent={openAgent} />
    </>
  );
}

function MobileShell({ resetLayout, openPalette, openAgent }) {
  return (
    <>
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
        <Outlet />
      </main>

      <StatusBar onOpenPalette={openPalette} onOpenAgent={openAgent}>
        <MobileNavDrawer onResetLayout={resetLayout} />
        <MobileInspectorDrawer />
      </StatusBar>
    </>
  );
}
