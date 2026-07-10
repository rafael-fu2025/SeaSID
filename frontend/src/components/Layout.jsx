import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from '@/components/ui/resizable';
import { useTheme } from '@/theme/ThemeContext';
import { SidebarNav } from './cockpit/SidebarNav';
import { Inspector } from './cockpit/Inspector';
import { StatusBar } from './cockpit/StatusBar';
import { CommandPalette } from './cockpit/CommandPalette';
import { AgentFab } from './AgentFab';

/**
 * SeaSID v3 cockpit shell.
 *
 *   ┌──────────┬────────────────────────────────────┬────────────┐
 *   │ Sidebar  │   <Outlet />                       │  Inspector │
 *   │  Nav     │     (active page)                  │  live data │
 *   │  (rail)  │                                    │  + alerts  │
 *   ├──────────┴────────────────────────────────────┴────────────┤
 *   │  StatusBar · build · clock · theme · ⌘K                    │
 *   └────────────────────────────────────────────────────────────┘
 *
 *  - Horizontal PanelGroup; sizes are persisted via `autoSaveId` in
 *    localStorage so the user's preferred rail/main/inspector balance
 *    survives reloads.
 *  - ⌘K / Ctrl+K toggles the CommandPalette globally. Theme cycling
 *    lives in StatusBar (and in the palette).
 *  - The shell never re-renders children based on route — Outlet swaps
 *    the main pane content while the rail and inspector stay mounted.
 */
export default function Layout() {
  const { cycleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K listener — Ctrl on Windows/Linux, Meta on macOS.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Hook the palette "refresh" command: any page can listen via
  // window.addEventListener('seasid:refresh', ...).
  useEffect(() => {
    if (!paletteOpen) return;
    const onRefresh = () => window.dispatchEvent(new CustomEvent('seasid:refresh'));
    // no-op listener — the palette already dispatches the event itself.
    return () => onRefresh;
  }, [paletteOpen]);

  const openAgent = useCallback(() => {
    window.dispatchEvent(new CustomEvent('seasid:open-agent'));
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="seasid-cockpit"
        className="flex-1"
      >
        <ResizablePanel
          defaultSize={4.5}
          minSize={3.5}
          maxSize={8}
          collapsible={false}
          className="min-w-[56px]"
        >
          <SidebarNav />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          defaultSize={68}
          minSize={45}
          className="min-w-0"
        >
          <main className="h-full overflow-y-auto bg-background">
            <Outlet />
          </main>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          defaultSize={27.5}
          minSize={18}
          maxSize={40}
          collapsible={false}
          className="min-w-[220px]"
        >
          <Inspector siteKey="dauin_muck" />
        </ResizablePanel>
      </ResizablePanelGroup>

      <StatusBar
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenAgent={openAgent}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onToggleTheme={cycleTheme}
      />

      <AgentFab />
    </div>
  );
}
