import { useState } from 'react';
import { Menu } from 'lucide-react';
import {
  Sheet, SheetContent, SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SidebarNav } from './SidebarNav';
import { cn } from '@/lib/utils';

/** Mobile navigation drawer rendered from the compact status bar. */

const NAV_DRAWER_WIDTH = 'w-[280px] sm:w-[320px]';

export function MobileNavDrawer() {
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
          hideCollapseChevron
        />
      </SheetContent>
    </Sheet>
  );
}
