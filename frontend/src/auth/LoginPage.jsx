import { useState } from 'react';
import { Eye, EyeOff, Loader2, Moon, Sun } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme } from '@/theme/ThemeContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * DepthContours — purely decorative "ocean depth" line-work for the
 * atmosphere panel. Thin, evenly-spaced wavy strokes in the subtle border
 * tokens, with a single reef-teal accent line. No neon, no glow — just
 * quiet line-art that echoes the cockpit's data-line motif.
 */
function DepthContours() {
  const lines = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <svg
      aria-hidden="true"
      className="login-contours pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 400 600"
      preserveAspectRatio="none"
    >
      {lines.map((i) => {
        const y = 40 + i * 72;
        const accent = i === 3;
        return (
          <path
            key={i}
            d={`M0 ${y} C 110 ${y - 26}, 290 ${y + 26}, 400 ${y}`}
            fill="none"
            stroke={accent ? 'var(--reef)' : 'var(--strong)'}
            strokeWidth={accent ? 1.4 : 1}
            strokeLinecap="round"
            opacity={accent ? 0.5 : 0.28}
          />
        );
      })}
    </svg>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const { theme, cycleTheme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const wordmark = theme === 'dark' ? '/seasid-light.png' : '/seasid.png';
  const mark = theme === 'dark' ? '/seasid_1x1-light.png' : '/seasid_1x1.png';

  // Keep decorative branding from being dragged out, right-click-saved, or
  // text-selected/copied — these are assets, not content to lift.
  const blockAsset = (event) => event.preventDefault();

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (requestError) {
      setError(requestError.message || 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-2">
      {/* ── Atmosphere panel (lg+) ─────────────────────────────────────── */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12"
        style={{
          background:
            'radial-gradient(115% 80% at 12% 8%, color-mix(in oklab, var(--reef) 12%, transparent), transparent 58%), ' +
            'linear-gradient(160deg, color-mix(in oklab, var(--inset) 45%, var(--background)), var(--background))',
        }}
      >
        {/* Diver animation — subtle background layer behind the depth
            contours; kept dim so foreground copy stays legible. */}
        <img
          src="/diver.gif"
          alt=""
          aria-hidden="true"
          draggable={false}
          onContextMenu={blockAsset}
          onDragStart={blockAsset}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-10 mix-blend-luminosity"
        />
        {/* Soft blur layer over the diver footage so it reads as ambient
            texture rather than sharp video behind the copy. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 backdrop-blur-sm"
        />
        <DepthContours />
        {/* Seam fade — blend the atmosphere panel into the sign-in panel's
            background instead of a hard divider line, for a seamless edge. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-r from-transparent to-background"
        />

        <div className="relative flex items-center gap-2 text-muted-foreground">
          <img
            src={mark}
            alt=""
            draggable={false}
            onContextMenu={blockAsset}
            onDragStart={blockAsset}
            className="size-7 select-none"
          />
          <span className="text-xs font-medium uppercase tracking-[0.18em]">
            Sea Safety Intelligence
          </span>
        </div>

        <div className="relative max-w-md">
          <img
            src={wordmark}
            alt="SeaSID"
            draggable={false}
            onContextMenu={blockAsset}
            onDragStart={blockAsset}
            className="mb-8 h-16 w-auto select-none"
          />
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
            Know before you go under.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            AI dive-condition forecasting for Dauin &amp; Apo Island — LSTM
            predictions, marine and air-quality signals, and a safety agent, in
            one calm cockpit.
          </p>
        </div>

        <p className="relative text-xs text-muted-foreground">
          Foundation University · Dumaguete City
        </p>
      </aside>

      {/* ── Sign-in panel ──────────────────────────────────────────────── */}
      <section className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4 size-9 text-muted-foreground"
          onClick={cycleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          data-testid="login-theme-toggle"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h2 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight text-foreground">
              <span>Sign in to</span>
              {/* Desktop keeps the wordmark as text (the big logo lives on
                  the atmosphere panel); mobile shows the logo inline. */}
              <span className="hidden lg:inline">SeaSID</span>
              <img
                src={wordmark}
                alt="SeaSID"
                draggable={false}
                onContextMenu={blockAsset}
                onDragStart={blockAsset}
                className="inline h-8 w-auto select-none lg:hidden"
              />
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Access forecasts, operator tools, and the safety agent.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit} data-testid="login-form">
            <div className="space-y-2">
              <Label htmlFor="auth-username">Username</Label>
              <Input
                id="auth-username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                data-testid="login-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-password">Password</Label>
              <div className="relative">
                <Input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="pr-10"
                  data-testid="login-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  data-testid="login-password-toggle"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-danger" role="alert" data-testid="login-error">
                {error}
              </p>
            )}
            <Button
              className="h-11 w-full font-bold"
              type="submit"
              disabled={submitting}
              data-testid="login-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </div>
      </section>

      {/* Film-grain overlay across the whole page for a premium texture.
          Click-through so it never blocks the form or theme toggle. */}
      <div
        aria-hidden="true"
        className="login-noise pointer-events-none absolute inset-0 z-10"
      />
    </main>
  );
}
