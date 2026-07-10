import { useState } from 'react';
import { Menu, Activity } from 'lucide-react';
import {
  Sheet, SheetContent, SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SidebarNav } from './SidebarNav';
import { Inspector } from './Inspector';
import { cn } from '@/lib/utils';

/**
 * Mobile drawer triggers — rendered as children of `<StatusBar>` so
 * the chrome is consistent across breakpoints.
 *
 *   - Hamburger opens `<Sheet side="left">` with `SidebarNav` in
 *     expanded mode (the in-rail chevron is hidden via
 *     `hideCollapseChevron` because the Sheet ships its own close).
 *   - "Inspect" icon opens `<Sheet side="right">` with `Inspector`
 *     expanded.
 *
 * The drawer widths (~280/320 px nav, ~340/420 px inspector) keep
 * main canvas comfortable without surrendering the whole viewport,
 * and the trigger buttons hide themselves above the `lg` breakpoint
 * (`hidden lg:flex` would be even tighter, but `size-7` + `lg:hidden`
 * is enough since desktop StatusBar never mounts them anyway).
 *
 * The reset button in the drawer footer is useful on mobile too
 * (the user might have toggled a rail persistence locally that
 * affects their next desktop session).
 */

const NAV_DRAWER_WIDTH = 'w-[280px] sm:w-[320px]';
const INSPECTOR_DRAWER_WIDTH = 'w-[340px] sm:w-[420px]';

export function MobileNavDrawer({ onResetLayout }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen} modal>
      <SheetTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(true)}
              aria-label="Open navigation menu"
              data-testid="open-mobile-nav"
              className="size-7 lg:hidden"
            >
              <Menu className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="above">Navigation</TooltipContent>
        </Tooltip>
      </SheetTrigger>
      <SheetContent
        side="left"
        className={cn('p-0', NAV_DRAWER_WIDTH)}
        data-testid="mobile-nav-drawer"
      >
        <SidebarNav
          collapsed={false}
          onToggle={undefined}
          onResetLayout={onResetLayout}
          hideCollapseChevron
        />
      </SheetContent>
    </Sheet>
  );
}

export function MobileInspectorDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen} modal>
      <SheetTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(true)}
              aria-label="Open live inspector"
              data-testid="open-mobile-inspector"
              className="size-7 lg:hidden"
            >
              <Activity className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="above">Inspector</TooltipContent>
        </Tooltip>
      </SheetTrigger>
      <SheetContent
        side="right"
        className={cn('p-0', INSPECTOR_DRAWER_WIDTH)}
        data-testid="mobile-inspector-drawer"
      >
        <Inspector
          siteKey="dauin_muck"
          collapsed={false}
          onToggle={undefined}
          hideCollapseChevron
        />
      </SheetContent>
    </Sheet>
  );
}
