import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/ThemeContext';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { SidebarNav } from './cockpit/SidebarNav';
import { StatusBar } from './cockpit/StatusBar';
import { CommandPalette } from './cockpit/CommandPalette';
import { useLayoutPrefs } from './cockpit/useLayoutPrefs';
import { MobileNavDrawer } from './cockpit/MobileDrawers';
import { AgentFab } from './AgentFab';

/**
 * SeaSID cockpit shell with a collapsible desktop navigation rail, a full-width
 * content canvas, and a mobile navigation drawer below the `lg` breakpoint.
 */
const WIDTH_LEFT_OPEN      = 'w-[240px]';
const WIDTH_LEFT_COLLAPSED = 'w-[64px]';

export default function Layout() {
  const { cycleTheme } = useTheme();
  const {
    leftCollapsed,
    toggleLeft,
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
          onToggleLeft={toggleLeft}
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

function DesktopShell({ leftCollapsed, onToggleLeft, resetLayout, openPalette, openAgent }) {
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
      </StatusBar>
    </>
  );
}
