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

// Friendly role names shown under the username. The raw role keys
// ("admin", "data_steward", …) stay in the auth payload only.
const ROLE_LABELS = {
  admin: 'Administrator',
  data_steward: 'Data Steward',
  operator: 'Operator',
  viewer: 'Viewer',
};

// Subtle per-role text tint — replaces the old bordered pill badge.
const ROLE_TEXT = {
  admin: 'text-reef',
  data_steward: 'text-amber',
  operator: 'text-emerald',
  viewer: 'text-muted-foreground',
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

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const roleText = ROLE_TEXT[user.role] || ROLE_TEXT.viewer;

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
              ? 'flex size-9 items-center justify-center self-center rounded-full border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'flex w-full items-center gap-3 rounded-full border border-border bg-card/60 py-1.5 pl-1.5 pr-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
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
              <span className={'block truncate text-[10px] font-medium ' + roleText}>
                {roleLabel}
              </span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? 'top' : 'right'}
        align={compact ? 'center' : 'start'}
        sideOffset={compact ? 6 : 8}
        alignOffset={compact ? 0 : 0}
        collisionPadding={8}
        className="w-56"
      >
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{user.username}</span>
          <span className={`text-[10px] font-medium ${roleText}`}>
            {roleLabel}
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
