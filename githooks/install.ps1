# Installs the SeaSID git hooks into this clone's hooks directory.
#
# Git hooks live under .git/ and are NOT version-controlled, so every clone
# must run this once (and again if the hook script changes). It copies the
# tracked githooks/pre-push into the active hooks path without touching git
# config.
#
#   pwsh -File githooks/install.ps1
#
$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel 2>$null)
if (-not $root) { throw 'Not inside a git repository.' }
$root = $root.Trim()

$src = Join-Path $root 'githooks/pre-push'
if (-not (Test-Path -LiteralPath $src)) { throw "Missing hook source: $src" }

$hooksDir = (& git rev-parse --git-path hooks).Trim()
if (-not [System.IO.Path]::IsPathRooted($hooksDir)) {
    $hooksDir = Join-Path $root $hooksDir
}
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

$dst = Join-Path $hooksDir 'pre-push'

# Copy with LF line endings so Git-for-Windows' bundled sh can execute it.
$content = [System.IO.File]::ReadAllText($src) -replace "`r`n", "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($dst, $content, $utf8NoBom)

Write-Host "Installed pre-push hook -> $dst"
