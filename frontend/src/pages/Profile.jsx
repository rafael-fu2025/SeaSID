import { useState } from 'react';
import { Save, ShieldCheck, KeyRound, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const ROLE_LABELS = {
  admin: 'Administrator',
  data_steward: 'Data steward',
  operator: 'Operator',
  viewer: 'Viewer',
};

export default function Profile() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);

  if (!user) {
    return null;
  }

  function confirmSignOut() {
    setSignOutDialogOpen(false);
    logout();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSavedAt(null);
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setSavedAt(new Date());
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to change password.');
    } finally {
      setBusy(false);
    }
  }

  const roleLabel = ROLE_LABELS[user.role] || user.role;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your identity, role, and sign-in settings.
        </p>
      </header>

      <Card data-testid="profile-identity">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-reef" aria-hidden />
            <CardTitle className="text-base">Identity</CardTitle>
          </div>
          <CardDescription>Read-only details from your bearer token.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Username" value={user.username} />
          <Field label="Role" value={`${roleLabel} (${user.role})`} />
          <Field
            label="Subject"
            value={user.subject || user.username}
            monospace
          />
          <Field
            label="Site scope"
            value={(user.site_keys || ['*']).join(', ') || '*'}
            monospace
          />
        </CardContent>
      </Card>

      <Card data-testid="profile-password">
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-reef" aria-hidden />
            <CardTitle className="text-base">Change password</CardTitle>
          </div>
          <CardDescription>
            Pick a password with at least 8 characters. Other admins cannot view it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="password-current">Current password</Label>
                <Input
                  id="password-current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password-next">New password</Label>
                <Input
                  id="password-next"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password-confirm">Confirm new password</Label>
                <Input
                  id="password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </div>
            </div>
            {error && (
              <p className="flex items-center gap-2 text-sm text-danger" role="alert">
                <ShieldAlert className="size-4" aria-hidden />
                {error}
              </p>
            )}
            {savedAt && (
              <p className="text-sm text-emerald" role="status">
                Password updated at {savedAt.toLocaleTimeString()}.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy}>
                <Save className="size-4" aria-hidden />
                {busy ? 'Saving…' : 'Update password'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSignOutDialogOpen(true)}
                disabled={busy}
                data-testid="profile-signout"
              >
                Sign out everywhere
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={signOutDialogOpen}
        onOpenChange={setSignOutDialogOpen}
        title="Sign out everywhere?"
        description="End this session on every device currently signed in with this account."
        confirmLabel="Sign out everywhere"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={confirmSignOut}
      />
    </div>
  );
}

function Field({ label, value, monospace }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={
          monospace
            ? 'rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground'
            : 'text-sm text-foreground'
        }
      >
        {value}
      </p>
    </div>
  );
}
