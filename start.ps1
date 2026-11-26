# Shastra Connect - one-step local launcher (Windows PowerShell 5.1+ / PowerShell 7)
#   Double-click START-HERE.cmd, or run:  powershell -ExecutionPolicy Bypass -File .\start.ps1
#   Options:  -FreshDemo   wipe and reload the demo school data
#             -NoBrowser   do not open the browser
param([switch]$FreshDemo, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Shastra Connect'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "`n[X] $msg" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function New-Secret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host ''
Write-Host '  SHASTRA CONNECT  -  one app for the whole school' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------'

# 1. Tools -------------------------------------------------------------------
Step 'Checking tools'
if (-not (Test-Cmd node)) { Fail 'Node.js is not installed. Install it with:  winget install OpenJS.NodeJS.LTS   then open a NEW window and run this again.' }
$nodeVer = [version]((node -v).TrimStart('v'))
if ($nodeVer -lt [version]'24.11.0') { Fail "Node.js $nodeVer is too old. Install Node 26 LTS:  winget install OpenJS.NodeJS.LTS" }
Ok "Node.js $nodeVer"
if (-not (Test-Cmd docker)) {
  $dd = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
  if (Test-Path $dd) { $env:PATH = "$dd;$env:PATH" } else { Fail 'Docker Desktop is not installed. Install it with:  winget install Docker.DockerDesktop' }
}

# 2. Docker engine -----------------------------------------------------------
Step 'Starting Docker'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $exe = @("$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe", "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { Fail 'Docker Desktop is not running and could not be found. Start Docker Desktop manually, then run this again.' }
  Start-Process $exe
  Write-Host '    Waiting for Docker Desktop (first start can take a minute)...'
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; docker info *> $null; if ($LASTEXITCODE -eq 0) { break } }
  if ($LASTEXITCODE -ne 0) { Fail 'Docker did not start in time. Open Docker Desktop, wait until it says "Engine running", then try again.' }
}
Ok 'Docker engine running'

# 3. .env --------------------------------------------------------------------
Step 'Checking configuration (.env)'
if (-not (Test-Path .env)) {
  $c = Get-Content .env.example -Raw
  $app = New-Secret 24
  $c = $c -replace '(?m)^POSTGRES_SUPERUSER_PASSWORD=.*$', "POSTGRES_SUPERUSER_PASSWORD=$(New-Secret 24)"
  $c = $c -replace '(?m)^DB_APP_PASSWORD=.*$', "DB_APP_PASSWORD=$app"
  $c = $c -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=postgresql://shastra_app:$app@localhost:5432/shastra"
  $c = $c -replace '(?m)^SESSION_SECRET=.*$', "SESSION_SECRET=$(New-Secret 48)"
  $c = $c -replace '(?m)^WHATSAPP_VERIFY_TOKEN=.*$', "WHATSAPP_VERIFY_TOKEN=$(New-Secret 32)"
  $c = $c -replace '(?m)^RAZORPAY_WEBHOOK_SECRET=.*$', "RAZORPAY_WEBHOOK_SECRET=$(New-Secret 32)"
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.env'), $c)
  Ok 'Created .env with fresh random secrets'
} else { Ok '.env found' }

# 4. Dependencies ------------------------------------------------------------
Step 'Installing dependencies'
$stamp = 'node_modules\.package-lock.json'
if (-not (Test-Path $stamp) -or (Get-Item package-lock.json).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed (see messages above).' }
}
Ok 'Dependencies ready'

# 5. Database ----------------------------------------------------------------
Step 'Starting the database (PostgreSQL 19)'
docker compose up -d db
if ($LASTEXITCODE -ne 0) { Fail 'Could not start the database container.' }
for ($i = 0; $i -lt 60; $i++) {
  $h = docker inspect -f '{{.State.Health.Status}}' shastra-dev-db-1 2>$null
  if ($h -eq 'healthy') { break }; Start-Sleep 2
}
if ($h -ne 'healthy') { Fail 'The database did not become healthy. Run:  docker compose logs db' }
Ok 'Database healthy'
npm run migrate --silent
if ($LASTEXITCODE -ne 0) { Fail 'Database migration failed (see messages above).' }

$users = (docker exec shastra-dev-db-1 psql -U postgres -d shastra -tAc 'SELECT COUNT(*) FROM users' 2>$null)
if ($FreshDemo -or "$users".Trim() -eq '0') {
  Step 'Loading demo school data'
  npm run seed --silent
  if ($LASTEXITCODE -ne 0) { Fail 'Loading demo data failed.' }
} else { Ok "Existing data kept ($("$users".Trim()) users). Use -FreshDemo to reload the demo school." }

# 6. Free the app ports from an earlier run ----------------------------------
foreach ($port in 5173, 4100) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { Write-Host "    Stopping old Shastra process on port $port"; Stop-Process -Id $p.Id -Force }
    elseif ($p) { Fail "Port $port is used by '$($p.ProcessName)' (pid $($p.Id)). Close it and try again." }
  }
}
# Stale dev-server cache is the usual cause of a blank page after updates.
Remove-Item -Recurse -Force node_modules\.vite, apps\web\node_modules\.vite -ErrorAction SilentlyContinue

# 7. Open the browser once the app answers ----------------------------------
if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    for ($i = 0; $i -lt 120; $i++) {
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5173/api/health | Out-Null; Start-Process 'http://localhost:5173'; return } catch { Start-Sleep 1 }
    }
  } | Out-Null
}

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Yellow
Write-Host '   Shastra Connect is starting:  http://localhost:5173' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'
Write-Host '   Principal   principal@shastra.school   Shastra@2026demo'
Write-Host '   Office      office@shastra.school      Shastra@2026demo'
Write-Host '   Teacher     teacher@shastra.school     Shastra@2026demo'
Write-Host '   Parent      Parent/Student tab, mobile 9000000001'
Write-Host '               -> the 6-digit code appears below as  "OTP for +919000000001: ######"'
Write-Host '  ------------------------------------------------------------'
Write-Host '   Keep this window open. Press Ctrl+C to stop the app.' -ForegroundColor Yellow
Write-Host '  ============================================================' -ForegroundColor Yellow
Write-Host ''

npm run dev
