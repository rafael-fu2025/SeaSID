import React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * App entry.
 *
 * Provider stack (outer → inner):
 *   ThemeProvider       — sets `data-theme` on <html> (dark / light)
 *   TooltipProvider     — supplies Radix tooltip context once so nested
 *                          SidebarNav / StatusBar labels can
 *                          call `<Tooltip>` without re-wrapping.
 *
 * Note: `SidebarProvider` was removed in v3; the legacy sidebar is gone
 * and the cockpit uses a fixed multi-pane layout, not a collapsible drawer.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={150}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
