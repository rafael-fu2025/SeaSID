import { useEffect, useState } from 'react';
import { Users as UsersIcon, Plus, Pencil, Trash2, ShieldCheck } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const VALID_ROLES = ['viewer', 'operator', 'data_steward', 'admin'];
const ROLE_LABELS = {
  admin: 'Administrator',
  data_steward: 'Data steward',
  operator: 'Operator',
  viewer: 'Viewer',
};

export default function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listUsers();
      setUsers(result.users || []);
    } catch (err) {
      setError(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <Card data-testid="admin-users">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UsersIcon className="size-4 text-reef" aria-hidden />
            <CardTitle className="text-base">Users</CardTitle>
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)} data-testid="admin-users-add">
            <Plus className="size-3.5" aria-hidden />
            Add user
          </Button>
        </div>
        <CardDescription>
          Admins can create, update, and revoke access. Existing env-configured
          users show up here once the API has run at least once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-danger" role="alert">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="admin-users-empty">
            No users yet. Add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Site scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid="admin-users-row">
                  <TableCell className="font-medium text-foreground">
                    <div className="flex flex-col">
                      <span>{u.username}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        subject: {u.subject}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABELS[u.role] || u.role}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {(u.site_keys || []).join(', ') || '*'}
                  </TableCell>
                  <TableCell>
                    {u.enabled ? (
                      <Badge variant="positive">Active</Badge>
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleString()
                      : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit user"
                        onClick={() => setEditing(u)}
                        data-testid="admin-users-edit"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete user"
                        onClick={() => setDeleting(u)}
                        data-testid="admin-users-delete"
                      >
                        <Trash2 className="size-3.5 text-danger" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {showAdd && (
        <UserEditDialog
          mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }}
        />
      )}
      {editing && (
        <UserEditDialog
          mode="update"
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          user={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); refresh(); }}
        />
      )}
    </Card>
  );
}

function UserEditDialog({ mode, initial, onClose, onSaved }) {
  const [username, setUsername] = useState(initial?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(initial?.role || 'viewer');
  const [siteKeys, setSiteKeys] = useState((initial?.site_keys || ['*']).join(','));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const parsedKeys = siteKeys.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      if (mode === 'create') {
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters.');
        }
        await api.createUser({
          username,
          password,
          role,
          site_keys: parsedKeys.length ? parsedKeys : ['*'],
        });
      } else {
        const updates = {
          role,
          site_keys: parsedKeys.length ? parsedKeys : ['*'],
          enabled,
        };
        if (password) {
          if (password.length < 8) {
            throw new Error('Password must be at least 8 characters.');
          }
          updates.password = password;
        }
        await api.updateUser(initial.id, updates);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Operation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add user' : 'Edit user'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'New users can sign in immediately after creation.'
              : 'Leave the password blank to keep the current one.'}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="user-username">Username</Label>
            <Input
              id="user-username"
              value={username}
              disabled={mode !== 'create'}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={1}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-password">
              {mode === 'create' ? 'Password' : 'New password (optional)'}
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={mode === 'create' ? 8 : 0}
              required={mode === 'create'}
              data-testid="user-password"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="user-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="user-role">
                  <SelectValue placeholder="Pick a role" />
                </SelectTrigger>
                <SelectContent>
                  {VALID_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-site-keys">Site keys (comma-separated)</Label>
              <Input
                id="user-site-keys"
                value={siteKeys}
                onChange={(event) => setSiteKeys(event.target.value)}
                placeholder="* or dauin_muck,apo_reef"
                data-testid="user-site-keys"
              />
            </div>
          </div>
          {mode !== 'create' && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                data-testid="user-enabled"
              />
              Enabled
            </label>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              <ShieldCheck className="size-4" aria-hidden />
              {busy ? 'Saving…' : (mode === 'create' ? 'Create user' : 'Save changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDeleteDialog({ user, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteUser(user.id);
      onDeleted();
    } catch (err) {
      setError(err.message || 'Delete failed.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete user?</DialogTitle>
          <DialogDescription>
            {user.username} will lose access immediately. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={busy}>
            <Trash2 className="size-4" aria-hidden />
            {busy ? 'Deleting…' : 'Delete user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
