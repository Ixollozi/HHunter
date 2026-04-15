param(
  [switch]$Dev
)

$ErrorActionPreference = "Stop"

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
    Write-Warn "Python не найден — пытаюсь установить через winget..."
    try {
      & $wg.Source install -e --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements | Out-Host
    } catch {
      Write-Warn "Не удалось установить Python через winget."
    }
  } else {
    Write-Warn "winget не найден — открою страницу скачивания Python."
    Try-OpenUrl "https://www.python.org/downloads/windows/"
  }

  # Попытка найти python после установки (PATH может обновиться не сразу)
  if (Get-Command "python" -ErrorAction SilentlyContinue) { return $true }
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python311\python.exe"
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $true } }

  Write-Err "Python всё ещё не найден. Установите Python 3.11+ и запустите установщик ещё раз."
  return $false
}

function Ensure-NodeInstalled() {
  if (Get-Command "npm" -ErrorAction SilentlyContinue) { return $true }

  $wg = Get-WinGet
  if ($wg) {
    Write-Warn "npm (Node.js) не найден — пытаюсь установить Node.js LTS через winget..."
    try {
      & $wg.Source install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Host
    } catch {
      Write-Warn "Не удалось установить Node.js через winget."
    }
  } else {
    Write-Warn "winget не найден — открою страницу скачивания Node.js."
    Try-OpenUrl "https://nodejs.org/en/download"
  }

  if (Get-Command "npm" -ErrorAction SilentlyContinue) { return $true }
  $npmCandidates = @(
    "$env:ProgramFiles\nodejs\npm.cmd",
    "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
  )
  foreach ($p in $npmCandidates) { if (Test-Path $p) { return $true } }

  Write-Err "Node.js/npm всё ещё не найден. Установите Node.js LTS и запустите установщик ещё раз."
  return $false
}

function Require-Command($name, $hint) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Err "$name не найден в PATH."
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
  $python = Require-Command "python" "Установите Python 3.11+ с python.org и отметьте 'Add to PATH'."
  Write-Info "Создаю .venv..."
  & $python "-m" "venv" (Join-Path $root ".venv")
  $py = Test-VenvPython $root
  if (-not $py) { throw "Не удалось создать .venv" }
  return $py
}

function Ensure-BackendEnv($root) {
  $envExample = Join-Path $root "backend\.env.example"
  $envFile = Join-Path $root "backend\.env"
  if (Test-Path $envFile) { return }
  if (-not (Test-Path $envExample)) { return }
  Write-Warn "Нет backend\.env — копирую из .env.example"
  Copy-Item -Force $envExample $envFile
  Write-Warn "Откройте backend\.env и поменяйте JWT_SECRET. Для Groq добавьте GROQ_KEY_FERNET_SECRET при необходимости."
}

function Ensure-PipDeps($venvPy, $root) {
  $req = Join-Path $root "requirements.txt"
  if (-not (Test-Path $req)) { throw "Нет requirements.txt" }
  Write-Info "Устанавливаю зависимости Python (pip)..."
  & $venvPy "-m" "pip" "install" "--upgrade" "pip" | Out-Host
  & $venvPy "-m" "pip" "install" "-r" $req | Out-Host
}

function Ensure-FrontendDeps($root) {
  if (-not (Ensure-NodeInstalled)) { throw "npm missing" }
  $npm = Require-Command "npm" "Установите Node.js LTS (он включает npm): https://nodejs.org/"
  $nodeModules = Join-Path $root "frontend\node_modules"
  if (Test-Path $nodeModules) { return $npm }
  Write-Info "Устанавливаю зависимости frontend (npm install)..."
  Push-Location (Join-Path $root "frontend")
  try {
    & $npm "install" | Out-Host
  } finally {
    Pop-Location
  }
  return $npm
}

function Run-App($venvPy, $root, $isDev) {
  $start = Join-Path $root "start.py"
  if (-not (Test-Path $start)) { throw "Нет start.py" }

  $args = @($start, "--migrate")
  if (-not $isDev) { $args += "--no-dev" }

  Write-Info ("Запуск: python " + ($args -join " "))
  Push-Location $root
  try {
    & $venvPy @args
  } finally {
    Pop-Location
  }
}

# --- main ---

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Info "Корень проекта: $root"

$okPy = Ensure-PythonInstalled
$okNode = Ensure-NodeInstalled
if (-not $okPy -or -not $okNode) {
  Write-Warn "После установки Python/Node может потребоваться перезапуск установщика (PATH обновится)."
  throw "Missing prerequisites"
}

$venvPy = Ensure-Venv $root
Ensure-BackendEnv $root

# Быстрая проверка: если уже есть site-packages marker, всё равно прогоняем pip (обновления/неполные установки).
Ensure-PipDeps $venvPy $root
Ensure-FrontendDeps $root | Out-Null

$isDev = $false
if ($Dev) { $isDev = $true }

Run-App $venvPy $root $isDev

