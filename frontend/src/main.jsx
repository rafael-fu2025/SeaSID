import React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { TooltipProvider } from '@/components/ui/tooltip';
// Cross-cutting provider that publishes the currently-loaded model tier
// and the latest experiment-suite winner. The Experiments page broadcasts
// ``seasid:experiments-complete`` + ``seasid:refresh`` after a run, and
// the StatusBar (plus any other consumer) reads the cached values here
// instead of issuing a second ``GET /health`` round-trip on every render.
import { ModelStatusProvider } from '@/components/ModelStatusContext';

/**
 * App entry.
 *
 * Provider stack (outer → inner):
 *   ThemeProvider       — sets `data-theme` on <html> (dark / light)
 *   TooltipProvider     — supplies Radix tooltip context once so nested
 *                          SidebarNav / StatusBar labels can
 *                          call `<Tooltip>` without re-wrapping.
 *   ModelStatusProvider — tracks the active ML tier and the best model
 *                          from the latest experiment run; listens for
 *                          ``seasid:experiments-complete`` to push the
 *                          new winner into every consumer without
 *                          prop-drilling.
 *
 * Note: `SidebarProvider` was removed in v3; the legacy sidebar is gone
 * and the cockpit uses a fixed multi-pane layout, not a collapsible drawer.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={150}>
        <ModelStatusProvider>
          <App />
        </ModelStatusProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
