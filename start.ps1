# Murmur — bring up the AuthPlane authorization server in Docker (Windows).
# The app itself runs natively (npm run dev -- --tunnel); this script
# only handles the AS side. Run this once; leave it running.
#
# Usage:
#   .\start.ps1                   # bring up AuthPlane + create demo users
#   .\start.ps1 -Stop             # docker compose down
#   .\start.ps1 -Reset            # wipe volumes and start fresh
[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$Reset
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# --- helpers ---------------------------------------------------------------
function New-Secret {
  param([int]$Bytes = 32)
  $b = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString("x2") })
}

function Set-Or-Append-Env {
  param([string]$Path, [string]$Key, [string]$Value)
  $line = "$Key=$Value"
  $existing = Get-Content $Path -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch "^$Key=" }
  $existing | Set-Content $Path
  Add-Content -Path $Path -Value $line
}

# --- subcommands -----------------------------------------------------------
if ($Stop) {
  docker compose down | Out-Null
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
  Write-Host "Stopped."
  exit 0
}
if ($Reset) {
  docker compose down -v | Out-Null
  if (Test-Path ".env.bak") { Remove-Item ".env.bak" -Force }
  Write-Host "Reset complete. Run .\start.ps1 to bring AuthPlane up again."
  exit 0
}

# --- .env load ------------------------------------------------------------
if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
      $name = $matches[1].Trim()
      $val = $matches[2].Trim()
      Set-Item -Path "Env:$name" -Value $val
    }
  }
}

# --- secrets --------------------------------------------------------------
if (-not $env:AUTHPLANE_ADMIN_API_KEY) {
  $env:AUTHPLANE_ADMIN_API_KEY = New-Secret
  Set-Or-Append-Env ".env" "AUTHPLANE_ADMIN_API_KEY" $env:AUTHPLANE_ADMIN_API_KEY
}
if (-not $env:AUTHPLANE_SESSION_SECRET) {
  $env:AUTHPLANE_SESSION_SECRET = New-Secret
  Set-Or-Append-Env ".env" "AUTHPLANE_SESSION_SECRET" $env:AUTHPLANE_SESSION_SECRET
}

# --- the two URLs ---------------------------------------------------------
# PUBLIC_APP_URL = the Alpic URL (stable, per-account).
#                 Set by the user after running `npm run dev -- --tunnel`.
# PUBLIC_AUTH_URL = the cloudflared URL for :9000 (rotates on restart).

if (-not $env:PUBLIC_APP_URL) {
  Write-Host ""
  Write-Host "  +-------------------------------------------------------------+"
  Write-Host "  | PUBLIC_APP_URL is empty.                                    |"
  Write-Host "  |                                                             |"
  Write-Host "  | 1. Open a second PowerShell terminal:                       |"
  Write-Host "  |      cd murmur\murmur-app                                    |"
  Write-Host "  |      npm install                                            |"
  Write-Host "  |      npm run dev -- --tunnel                                |"
  Write-Host "  |                                                             |"
  Write-Host "  | 2. Copy the Alpic URL (e.g. https://xxx.alpic.dev)          |"
  Write-Host "  |                                                             |"
  Write-Host "  | 3. Paste it below, or set PUBLIC_APP_URL in .env            |"
  Write-Host "  +-------------------------------------------------------------+"
  Write-Host ""
  $env:PUBLIC_APP_URL = (Read-Host "  Alpic URL (Enter to defer)").Trim()
}
$env:PUBLIC_APP_URL = $env:PUBLIC_APP_URL.TrimEnd("/")
Set-Or-Append-Env ".env" "PUBLIC_APP_URL" $env:PUBLIC_APP_URL

# --- cloudflared for :9000 -----------------------------------------------
$cfExe = Join-Path $ScriptDir "tools\cloudflared.exe"
if (-not (Test-Path $cfExe)) {
  Write-Error "cloudflared.exe not found at $cfExe. Copy it from the authplane-challenge tools/ or download from https://github.com/cloudflare/cloudflared/releases."
}
$cfLog = Join-Path $ScriptDir "tools\cloudflared-auth.log"
$cfAlready = Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $cfExe -or $_.MainWindowTitle -match "9000" }
if (-not $cfAlready) {
  Write-Host "-> Starting cloudflared quick tunnel for :9000"
  Start-Process -FilePath $cfExe `
    -ArgumentList @("tunnel","--url","http://localhost:9000","--no-autoupdate") `
    -RedirectStandardOutput $cfLog `
    -RedirectStandardError $cfLog `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# Wait for the URL to appear in the log
$AUTH_URL = $null
for ($i = 0; $i -lt 40; $i++) {
  if (Test-Path $cfLog) {
    $match = Select-String -Path $cfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) { $AUTH_URL = $match.Matches[0].Value; break }
  }
  Start-Sleep -Seconds 1
}
if (-not $AUTH_URL) {
  Write-Error "cloudflared did not produce a URL within 40s. Check $cfLog"
}
$env:PUBLIC_AUTH_URL = $AUTH_URL.TrimEnd("/")
Set-Or-Append-Env ".env" "PUBLIC_AUTH_URL" $env:PUBLIC_AUTH_URL
Write-Host "  AS tunnel: $env:PUBLIC_AUTH_URL"

# --- docker compose up ----------------------------------------------------
Write-Host "-> Bringing up AuthPlane container..."
docker compose up -d

# --- wait for /health ----------------------------------------------------
Write-Host "-> Waiting for AuthPlane /health..."
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$env:PUBLIC_AUTH_URL/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $healthy = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if ($healthy) {
  Write-Host "  healthy at $env:PUBLIC_AUTH_URL"
} else {
  Write-Warning "AuthPlane did not become healthy within 40s. Check 'docker compose logs authserver'."
}

# --- demo users ----------------------------------------------------------
Write-Host "-> Creating demo users (idempotent)..."
$users = @(
  @{ email = $env:DEMO_USER_1_EMAIL; pw = $env:DEMO_USER_1_PASSWORD; name = "Harsh" },
  @{ email = $env:DEMO_USER_2_EMAIL; pw = $env:DEMO_USER_2_PASSWORD; name = "Maya" }
)
foreach ($u in $users) {
  docker compose exec -T authserver `
    /authserver admin user create --email $u.email --name $u.name --password $u.pw 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  + $($u.email)"
  } else {
    Write-Host "  . $($u.email) (exists)"
  }
}

# --- cheat sheet ---------------------------------------------------------
Write-Host ""
Write-Host "-------------------------------------------------------------------"
Write-Host "  AuthPlane AS : $env:PUBLIC_AUTH_URL"
Write-Host "  Murmur app   : $env:PUBLIC_APP_URL/mcp"
Write-Host "  Admin UI     : http://127.0.0.1:9001/admin/ui/"
Write-Host "                 (paste `$env:AUTHPLANE_ADMIN_API_KEY when prompted)"
Write-Host ""
Write-Host "  Demo users:"
Write-Host "    $($env:DEMO_USER_1_EMAIL) / $($env:DEMO_USER_1_PASSWORD)"
Write-Host "    $($env:DEMO_USER_2_EMAIL) / $($env:DEMO_USER_2_PASSWORD)"
Write-Host ""
Write-Host "  Next: in a second terminal:"
Write-Host "    cd murmur\murmur-app"
Write-Host "    npm install"
Write-Host "    npm run dev -- --tunnel"
Write-Host ""
Write-Host "  Then add $($env:PUBLIC_APP_URL)/mcp as a custom connector in"
Write-Host "  Claude (Customize -> Connectors) or ChatGPT (Profile -> Apps)."
Write-Host ""
Write-Host "  Verify: node scripts\e2e-oauth.mjs --headless --user harsh"
Write-Host "-------------------------------------------------------------------"
