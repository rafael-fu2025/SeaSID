# ── infra/cloudflared/tunnel.ps1 ────────────────────────────────────────────
#
# One-shot launcher that wires the frontend + backend + cloudflared
# tunnels together for remote testing from a phone, a tablet, or
# another machine.
#
# What it does, in order:
#   1. Starts the FastAPI backend on :8000.
#   2. Starts Vite (frontend) on :5173.
#   3. Spawns a cloudflared quick tunnel for the backend. Waits until
#      cloudflared prints a https://*.trycloudflare.com URL, then
#      extracts it and writes it to the frontend's .env.local as
#      VITE_API_URL (Vite reads this on dev-server start).
#   4. Spawns a cloudflared quick tunnel for the frontend.
#   5. Restarts the Vite dev server so it picks up the now-known
#      VITE_API_URL (Vite only reads .env files on startup).
#   6. Prints the two public URLs in a single block at the end so the
#      operator can copy/paste them.
#
# Ctrl-C tears down everything.
#
# Why two cloudflared processes (instead of one named tunnel with
# ingress rules)?
#   - Zero setup. Quick tunnels don't need a Cloudflare account, no
#     credentials file, no DNS records. Perfect for a one-off demo.
#   - SSE/WebSocket stickiness: each tunnel gets a single dedicated
#     cloudflared edge connection, which is what SSE / chat-stream
#     endpoints need to stay alive.
#   The downside is two processes instead of one — acceptable for a
#   dev setup. If we move to production with stable hostnames, we'd
#   convert to a named tunnel with ingress rules.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')  # project root

$logDir = 'infra\cloudflared\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Start-BackgroundProcess($label, $exe, $argList, $cwd) {
    $logOut = Join-Path $logDir "$label.out.log"
    $logErr = Join-Path $logDir "$label.err.log"
    # Force the parameter into a string array. PowerShell's parameter
    # binder sometimes collapses an empty/empty-ish array into $null
    # when splatting across functions, which then trips Start-Process's
    # "argument contains a null value" guard. The [string[]] cast
    # materialises the values before they leave this scope.
    $stringArgs = @()
    foreach ($a in $argList) {
        if ($null -eq $a) { continue }
        $stringArgs += [string]$a
    }
    $p = Start-Process -FilePath $exe `
        -ArgumentList $stringArgs `
        -WorkingDirectory $cwd `
        -RedirectStandardOutput $logOut `
        -RedirectStandardError  $logErr `
        -NoNewWindow -PassThru
    Write-Host "[$label] PID $($p.Id), logs: $logOut" -ForegroundColor DarkGray
    return $p
}

# ── 1. Backend ───────────────────────────────────────────────────────────
Write-Host "Starting backend on :8000…" -ForegroundColor Cyan
$backend = Start-BackgroundProcess -label 'backend' `
    -exe 'python' -args @('-m', 'scripts.run_api') `
    -cwd 'backend'

# ── 2. Frontend (initial start; we'll restart after we know the backend URL) ─
Write-Host "Starting frontend on :5173 (placeholder VITE_API_URL)…" -ForegroundColor Cyan
$frontend = Start-BackgroundProcess -label 'frontend' `
    -exe 'npm.cmd' -args @('run', 'dev') `
    -cwd 'frontend'

# ── Wait for Vite to start ─────────────────────────────────────────────────
Write-Host "Waiting for Vite to come up…" -ForegroundColor Yellow
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1
        if ($r.StatusCode -eq 200) { Write-Host "Vite is up." -ForegroundColor Green; break }
    } catch {}
    Start-Sleep -Seconds 1
}

# ── 3. Tunnel the backend, capture the URL ───────────────────────────────
Write-Host "Starting backend tunnel (cloudflared)…" -ForegroundColor Cyan
$beTunnel = Start-BackgroundProcess -label 'tunnel-backend' `
    -exe 'cloudflared' -args @('tunnel', '--url', 'http://localhost:8000', '--no-autoupdate') `
    -cwd (Get-Location)

$beUrl = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    $log = Get-Content (Join-Path $logDir 'tunnel-backend.out.log') -Raw -ErrorAction SilentlyContinue
    if ($log -and $log -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $beUrl = ($matches[0]).TrimEnd('.')
        break
    }
}
if (-not $beUrl) {
    Write-Host "Failed to detect backend tunnel URL. Check infra\cloudflared\logs\tunnel-backend.out.log" -ForegroundColor Red
    exit 1
}
Write-Host "Backend tunnel: $beUrl" -ForegroundColor Green

# ── 4. Tunnel the frontend, capture the URL ──────────────────────────────
Write-Host "Starting frontend tunnel (cloudflared)…" -ForegroundColor Cyan
$feTunnel = Start-BackgroundProcess -label 'tunnel-frontend' `
    -exe 'cloudflared' -args @('tunnel', '--url', 'http://localhost:5173', '--no-autoupdate') `
    -cwd (Get-Location)

$feUrl = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    $log = Get-Content (Join-Path $logDir 'tunnel-frontend.out.log') -Raw -ErrorAction SilentlyContinue
    if ($log -and $log -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $feUrl = ($matches[0]).TrimEnd('.')
        break
    }
}
if (-not $feUrl) {
    Write-Host "Failed to detect frontend tunnel URL. Check infra\cloudflared\logs\tunnel-frontend.out.log" -ForegroundColor Red
    exit 1
}
Write-Host "Frontend tunnel: $feUrl" -ForegroundColor Green

# ── 5. Wire the frontend's VITE_API_URL to the backend tunnel URL ────────
# Vite only reads .env files on startup, so we have to rewrite
# `frontend/.env.local` (which is .gitignored) and bounce Vite.
$envLocal = 'frontend\.env.local'
"VITE_API_URL=$beUrl" | Out-File -FilePath $envLocal -Encoding utf8 -Force
Write-Host "Wrote $envLocal with VITE_API_URL=$beUrl" -ForegroundColor DarkGray

Write-Host "Restarting Vite so it picks up VITE_API_URL…" -ForegroundColor Cyan
if (-not $frontend.HasExited) { Stop-Process -Id $frontend.Id -Force }
$frontend = Start-BackgroundProcess -label 'frontend' `
    -exe 'npm.cmd' -args @('run', 'dev') `
    -cwd 'frontend'

# ── 6. Print the final block ──────────────────────────────────────────────
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  SeaSID is live via Cloudflare Tunnel"             -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Open this on your phone / another machine:"       -ForegroundColor Green
Write-Host "    $feUrl"                                          -ForegroundColor Cyan
Write-Host ""
Write-Host "  The frontend is configured to call the API at:"
Write-Host "    $beUrl"                                          -ForegroundColor Cyan
Write-Host ""
Write-Host "  The backend CORS allowlist includes both origins." -ForegroundColor DarkGray
Write-Host "  Press Ctrl-C in this window to tear everything down." -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Green

# ── Watchdog: kill everything if any process dies ────────────────────────
try {
    while ($true) {
        if ($backend.HasExited)  { Write-Host "backend exited (code $($backend.ExitCode))" -ForegroundColor Red; break }
        if ($frontend.HasExited) { Write-Host "frontend exited (code $($frontend.ExitCode))" -ForegroundColor Red; break }
        if ($beTunnel.HasExited) { Write-Host "backend tunnel exited (code $($beTunnel.ExitCode))" -ForegroundColor Red; break }
        if ($feTunnel.HasExited) { Write-Host "frontend tunnel exited (code $($feTunnel.ExitCode))" -ForegroundColor Red; break }
        Start-Sleep -Seconds 2
    }
} finally {
    foreach ($p in @($backend, $frontend, $beTunnel, $feTunnel)) {
        if ($p -and -not $p.HasExited) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}