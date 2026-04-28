param(
  [switch]$Dev
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info($msg) { Write-Host "[HHunter] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[HHunter] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[HHunter] $msg" -ForegroundColor Red }

function Try-OpenUrl($url) {
  try { Start-Process $url | Out-Null } catch { }
}

function Get-WinGet() {
  return (Get-Command "winget" -ErrorAction SilentlyContinue)
}

function Ensure-PythonInstalled() {
  if (Get-Command "python" -ErrorAction SilentlyContinue) { return $true }
  $wg = Get-WinGet
  if ($wg) {
    Write-Warn "Python not found - trying winget..."
    try {
      & $wg.Source install -e --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements | Out-Host
    } catch { Write-Warn "Could not install Python via winget." }
  } else {
    Write-Warn "winget not found - opening Python download page."
    Try-OpenUrl "https://www.python.org/downloads/windows/"
  }
  if (Get-Command "python" -ErrorAction SilentlyContinue) { return $true }
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python311\python.exe"
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $true } }
  Write-Err "Python still not found. Install Python 3.11+ and run setup again."
  return $false
}

function Ensure-NodeInstalled() {
  if (Get-Command "npm" -ErrorAction SilentlyContinue) { return $true }
  $wg = Get-WinGet
  if ($wg) {
    Write-Warn "npm not found - trying to install Node.js LTS via winget..."
    try {
      & $wg.Source install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Host
    } catch { Write-Warn "Could not install Node.js via winget." }
  } else {
    Write-Warn "winget not found - opening Node.js download page."
    Try-OpenUrl "https://nodejs.org/en/download"
  }
  if (Get-Command "npm" -ErrorAction SilentlyContinue) { return $true }
  $npmCandidates = @(
    "$env:ProgramFiles\nodejs\npm.cmd",
    "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
  )
  foreach ($p in $npmCandidates) { if (Test-Path $p) { return $true } }
  Write-Err "Node.js/npm still not found. Install Node.js LTS and run setup again."
  return $false
}

function Require-Command($name, $hint) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Err "$name not found in PATH."
    if ($hint) { Write-Warn $hint }
    throw "$name missing"
  }
  return $cmd.Source
}

function Test-VenvPython($root) {
  $py = Join-Path $root ".venv\Scripts\python.exe"
  if (Test-Path $py) { return $py }
  return $null
}

function Ensure-Venv($root) {
  $py = Test-VenvPython $root
  if ($py) { return $py }
  if (-not (Ensure-PythonInstalled)) { throw "python missing" }
  $python = Require-Command "python" "Install Python 3.11+ from python.org, check Add to PATH."
  Write-Info "Creating .venv..."
  & $python "-m" "venv" (Join-Path $root ".venv")
  $py = Test-VenvPython $root
  if (-not $py) { throw "Failed to create .venv" }
  return $py
}

function Ensure-BackendEnv($root) {
  $envExample = Join-Path $root "backend\.env.example"
  $envFile = Join-Path $root "backend\.env"
  if (Test-Path $envFile) { return }
  if (-not (Test-Path $envExample)) { return }
  Write-Warn "No backend\.env - copying from .env.example"
  Copy-Item -Force $envExample $envFile
  Write-Warn "Open backend\.env and change JWT_SECRET before production use."
}

function Ensure-PipDeps($venvPy, $root) {
  $req = Join-Path $root "requirements.txt"
  if (-not (Test-Path $req)) { throw "No requirements.txt found" }
  Write-Info "Installing Python dependencies..."
  & $venvPy "-m" "pip" "install" "--upgrade" "pip" | Out-Host
  & $venvPy "-m" "pip" "install" "-r" $req | Out-Host
}

function Ensure-FrontendDeps($root) {
  if (-not (Ensure-NodeInstalled)) { throw "npm missing" }
  $npm = Require-Command "npm" "Install Node.js LTS: https://nodejs.org/"
  $nodeModules = Join-Path $root "frontend\node_modules"
  if (Test-Path $nodeModules) { return $npm }
  Write-Info "Installing frontend dependencies (npm install)..."
  Push-Location (Join-Path $root "frontend")
  try {
    & $npm "install" | Out-Host
  } finally {
    Pop-Location
  }
  return $npm
}

function Ensure-SafePath($currentRoot) {
  $hasCyrillic = $currentRoot -match '[а-яёА-ЯЁ]'
  if (-not $hasCyrillic) { return $currentRoot }

  $safeTarget = "C:\HHunter"
  Write-Warn "Path contains Cyrillic characters - this breaks Python venv and npm."
  Write-Warn "Copying project to $safeTarget ..."

  if (-not (Test-Path $safeTarget)) {
    New-Item -ItemType Directory -Path $safeTarget -Force | Out-Null
  }

  $excludeDirs = @(".venv", "node_modules", "__pycache__", "dist", ".git")
  Get-ChildItem -Path $currentRoot -Force | Where-Object {
    $excludeDirs -notcontains $_.Name
  } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $safeTarget -Recurse -Force
  }

  Write-Info "Project copied to $safeTarget"
  return $safeTarget
}

function Create-DesktopShortcut($root) {
  try {
    $venvPy = Join-Path $root ".venv\Scripts\python.exe"
    $startPy = Join-Path $root "start.py"
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "HHunter.lnk"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "C:\Windows\System32\cmd.exe"
    $shortcut.Arguments = "/k cd /d `"$root`" && `"$venvPy`" `"$startPy`" --no-dev"
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = "HHunter"
    $shortcut.WindowStyle = 1
    $shortcut.Save()

    Write-Info "Desktop shortcut created: HHunter.lnk"
  } catch {
    Write-Warn "Could not create desktop shortcut: $_"
  }
}

function Run-App($venvPy, $root, $isDev) {
  $start = Join-Path $root "start.py"
  if (-not (Test-Path $start)) { throw "No start.py found" }
  $runArgs = @($start, "--migrate")
  if (-not $isDev) { $runArgs += "--no-dev" }
  Write-Info ("Starting: python " + ($runArgs -join " "))
  Push-Location $root
  try {
    & $venvPy @runArgs
  } finally {
    Pop-Location
  }
}

# --- main ---

$originalRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Info "Project root: $originalRoot"

$root = Ensure-SafePath $originalRoot

$okPy = Ensure-PythonInstalled
$okNode = Ensure-NodeInstalled
if (-not $okPy -or -not $okNode) {
  Write-Warn "After installing Python/Node restart setup - PATH needs to update."
  pause
  exit 1
}

$venvPy = Ensure-Venv $root
Ensure-BackendEnv $root
Ensure-PipDeps $venvPy $root
Ensure-FrontendDeps $root | Out-Null

Create-DesktopShortcut $root

Write-Info "Setup complete! Starting HHunter..."
$isDev = $false
if ($Dev) { $isDev = $true }

Run-App $venvPy $root $isDev