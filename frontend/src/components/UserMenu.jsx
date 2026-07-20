import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, User as UserIcon, ChevronDown } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ROLE_BADGE = {
  admin: 'bg-reef/15 text-reef border-reef/40',
  data_steward: 'bg-amber/15 text-amber border-amber/40',
  operator: 'bg-emerald/15 text-emerald border-emerald/40',
  viewer: 'bg-muted text-muted-foreground border-border',
};

export default function UserMenu({ variant = 'sidebar' }) {
  const compact = variant === 'compact';
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);

  if (loading || !user) {
    return null;
  }

  const roleClass = ROLE_BADGE[user.role] || ROLE_BADGE.viewer;

  function handleSignOut() {
    // Close the dropdown first so the dialog is rendered against a clean
    // overlay, then prompt the user to confirm.
    setOpen(false);
    setSignOutDialogOpen(true);
  }

  function confirmSignOut() {
    logout();
    setSignOutDialogOpen(false);
    navigate('/');
  }

  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          data-testid="user-menu-trigger"
          className={
            compact
              ? 'flex size-8 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'flex w-full items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          }
        >
          <span className={
            compact
              ? 'flex size-6 items-center justify-center rounded-full bg-reef/15 text-reef text-xs font-semibold'
              : 'flex size-9 shrink-0 items-center justify-center rounded-full bg-reef text-reef-foreground text-sm font-semibold shadow-sm'
          }>
            {(user.username || '?').slice(0, 2).toUpperCase()}
          </span>
          {compact ? null : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{user.username}</span>
              <span className={'mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' + roleClass}>
                {user.role}
              </span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align={compact ? 'center' : 'start'}
        sideOffset={compact ? 6 : 4}
        className="w-56"
      >
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{user.username}</span>
          <span
            className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleClass}`}
          >
            {user.role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile" className="flex items-center gap-2" data-testid="user-menu-profile">
            <UserIcon className="size-3.5" aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" className="flex items-center gap-2" data-testid="user-menu-settings">
            <UserIcon className="size-3.5" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleSignOut}
          className="flex items-center gap-2 text-danger focus:text-danger"
          data-testid="user-menu-logout"
        >
          <LogOut className="size-3.5" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ConfirmDialog
      open={signOutDialogOpen}
      onOpenChange={setSignOutDialogOpen}
      title="Sign out of SeaSID?"
      description="You will need to log back in to view forecasts, agents, and admin pages."
      confirmLabel="Sign out"
      cancelLabel="Stay signed in"
      tone="danger"
      onConfirm={confirmSignOut}
    />
    </>
  );
}
