#!/usr/bin/env python3
"""
Запуск HHunter из корня репозитория.

Без --dev фронт поднимается через vite preview: перед стартом выполняется npm run build,
если нет dist/ или файлы в frontend/src новее dist/index.html (чтобы правки UI не «терялись»).

Ожидаемая структура:
  <repo>/
    .venv/              интерпретатор (python -m venv .venv в корне)
    requirements.txt
    start.py
    backend/
      .env              настройки API (см. backend/.env.example)
    frontend/
    database/
"""

from __future__ import annotations

import argparse
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
DATABASE_DIR = ROOT / "database"

# Файлы фронта, при изменении которых нужен npm run build (режим preview).
_FRONTEND_ROOT_WATCH = (
    "vite.config.js",
    "vite.config.ts",
    "tailwind.config.js",
    "postcss.config.js",
    "index.html",
    "package.json",
    "package-lock.json",
)
# Исходники в src/ + статика в public/
_FRONTEND_SRC_SUFFIXES = frozenset(
    {".jsx", ".tsx", ".js", ".ts", ".mjs", ".cjs", ".css", ".json", ".html", ".svg", ".md", ".woff2"}
)


def venv_python() -> Path:
    if sys.platform == "win32":
        return ROOT / ".venv" / "Scripts" / "python.exe"
    return ROOT / ".venv" / "bin" / "python"


def _is_windows() -> bool:
    return sys.platform == "win32"


def _popen_kwargs() -> dict:
    """
    Windows: отдельная группа процессов, чтобы корректно останавливать дочерние процессы.
    """
    if not _is_windows():
        return {}
    return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}  # type: ignore[attr-defined]


def _safe_popen(cmd: list[str], cwd: Path) -> subprocess.Popen:
    """
    Важно для Windows/PowerShell: многие CLI (особенно node/vite) могут менять режим ввода консоли.
    Если их убить, режим может не восстановиться и стрелки истории перестают работать.

    Поэтому:
    - stdin отключаем (DEVNULL), чтобы дочерние процессы не переводили терминал в raw-mode
    - создаём отдельную process group (см. _popen_kwargs)
    """
    return subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdin=subprocess.DEVNULL,
        **_popen_kwargs(),
    )


def _run_checked(cmd: list[str], cwd: Path) -> int:
    r = subprocess.run(cmd, cwd=str(cwd), check=False)
    return int(r.returncode or 0)


def _max_mtime_tree(root: Path, suffixes: frozenset[str]) -> float | None:
    """Самый новый mtime среди файлов под root с указанными расширениями."""
    if not root.is_dir():
        return None
    newest: float | None = None
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        suf = p.suffix.lower()
        if suf not in suffixes:
            continue
        try:
            m = p.stat().st_mtime
            if newest is None or m > newest:
                newest = m
        except OSError:
            continue
    return newest


def frontend_preview_needs_build(frontend_dir: Path) -> bool:
    """
    True, если для vite preview нужна свежая сборка: нет dist или исходники новее dist/index.html.

    Раньше сборка делалась только при отсутствии dist — из‑за этого UI «застывал» после правок в src/.
    """
    dist_index = frontend_dir / "dist" / "index.html"
    if not dist_index.exists():
        return True
    try:
        dist_mtime = dist_index.stat().st_mtime
    except OSError:
        return True
    for name in _FRONTEND_ROOT_WATCH:
        p = frontend_dir / name
        if p.is_file():
            try:
                if p.stat().st_mtime > dist_mtime:
                    return True
            except OSError:
                return True
    src_dir = frontend_dir / "src"
    m_src = _max_mtime_tree(src_dir, _FRONTEND_SRC_SUFFIXES)
    if m_src is not None and m_src > dist_mtime:
        return True
    public_dir = frontend_dir / "public"
    m_pub = _max_mtime_tree(public_dir, _FRONTEND_SRC_SUFFIXES)
    if m_pub is not None and m_pub > dist_mtime:
        return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="HHunter starter (lightweight by default).")
    ap.add_argument("--dev", action="store_true", help="Dev mode: uvicorn --reload + vite dev (heavy).")
    ap.add_argument("--no-frontend", action="store_true", help="Do not start frontend.")
    ap.add_argument("--no-backend", action="store_true", help="Do not start backend.")
    ap.add_argument("--host", default="127.0.0.1", help="Backend host (default: 127.0.0.1).")
    ap.add_argument("--port", default="8000", help="Backend port (default: 8000).")
    ap.add_argument("--frontend-port", default="5173", help="Frontend port (default: 5173).")
    ap.add_argument(
        "--migrate",
        action="store_true",
        help="Run alembic upgrade head before starting backend (recommended).",
    )
    ap.add_argument(
        "--force-frontend-build",
        action="store_true",
        help="Всегда выполнить npm run build перед preview (режим без --dev).",
    )
    ap.add_argument(
        "--skip-frontend-build",
        action="store_true",
        help="Не пересобирать фронт перед preview, даже если исходники новее dist (быстрый старт).",
    )
    args = ap.parse_args()

    py = venv_python()
    if not py.exists():
        print("Нет корневого .venv. Один раз выполните в корне репозитория:", file=sys.stderr)
        print("  python -m venv .venv", file=sys.stderr)
        if sys.platform == "win32":
            print(r"  .\.venv\Scripts\Activate.ps1", file=sys.stderr)
        else:
            print("  source .venv/bin/activate", file=sys.stderr)
        print("  pip install -r requirements.txt", file=sys.stderr)
        print(r"  copy backend\.env.example backend\.env   # Windows, затем заполните", file=sys.stderr)
        return 1

    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        print(
            "Предупреждение: нет backend\\.env — скопируйте backend\\.env.example и заполните.",
            file=sys.stderr,
        )

    DATABASE_DIR.mkdir(parents=True, exist_ok=True)

    npm = shutil.which("npm")
    if not npm:
        print("npm не найден в PATH.", file=sys.stderr)
        return 1

    if not args.no_frontend:
        if not (FRONTEND_DIR / "node_modules").exists():
            print("Устанавливаю зависимости frontend (npm install)...")
            rc = _run_checked([npm, "install"], cwd=FRONTEND_DIR)
            if rc != 0:
                return rc

    procs: list[subprocess.Popen] = []

    def stop_all() -> None:
        # Windows: npm запускается через .cmd, а при Ctrl+C cmd.exe может спрашивать
        # «Завершить выполнение пакетного процесса (Y/N)?». Чтобы это не появлялось,
        # останавливаем дерево процессов через taskkill, без интерактивных промптов.
        if _is_windows():
            taskkill = shutil.which("taskkill")
            if taskkill:
                for p in procs:
                    if p.poll() is None:
                        try:
                            subprocess.run(
                                [taskkill, "/PID", str(p.pid), "/T", "/F"],
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                                check=False,
                            )
                        except Exception:
                            pass
            time.sleep(0.2)
        for p in procs:
            if p.poll() is None:
                p.terminate()
        deadline = time.monotonic() + 5.0
        for p in procs:
            if p.poll() is None:
                try:
                    p.wait(timeout=max(0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    p.kill()

    def on_signal(_signum: int, _frame: object) -> None:
        stop_all()
        sys.exit(130)

    # SIGTERM is not reliably delivered on Windows in the same way; handle Ctrl+C and POSIX SIGTERM.
    if not _is_windows():
        signal.signal(signal.SIGTERM, on_signal)

    try:
        if args.migrate and not args.no_backend:
            # Run migrations using runtime DB_URL from backend/config.py.
            print("Alembic: upgrade head...")
            rc = _run_checked([str(py), "-m", "alembic", "upgrade", "head"], cwd=ROOT)
            if rc != 0:
                return rc

        if not args.no_backend:
            backend_cmd = [
                str(py),
                "-m",
                "uvicorn",
                "backend.main:app",
                "--host",
                str(args.host),
                "--port",
                str(args.port),
            ]
            if args.dev:
                backend_cmd.insert(backend_cmd.index("--host"), "--reload")
            procs.append(_safe_popen(backend_cmd, cwd=ROOT))

        if not args.no_frontend:
            if args.dev:
                procs.append(_safe_popen([npm, "run", "dev"], cwd=FRONTEND_DIR))
            else:
                # Режим preview: dist без HMR. Пересобираем, если нет dist или исходники новее сборки.
                dist_index = FRONTEND_DIR / "dist" / "index.html"
                if not dist_index.exists():
                    need_build = True
                else:
                    need_build = args.force_frontend_build or (
                        not args.skip_frontend_build and frontend_preview_needs_build(FRONTEND_DIR)
                    )
                if need_build:
                    print("Frontend build (npm run build)...")
                    rc = _run_checked([npm, "run", "build"], cwd=FRONTEND_DIR)
                    if rc != 0:
                        return rc
                procs.append(
                    _safe_popen(
                        [npm, "run", "preview", "--", "--host", "127.0.0.1", "--port", str(args.frontend_port)],
                        cwd=FRONTEND_DIR,
                    )
                )
    except OSError as e:
        print(f"Ошибка запуска: {e}", file=sys.stderr)
        stop_all()
        return 1

    print("Корень проекта:", ROOT)
    backend_url = f"http://{args.host}:{args.port}" if not args.no_backend else "(backend off)"
    frontend_url = f"http://127.0.0.1:{args.frontend_port}" if not args.no_frontend else "(frontend off)"
    mode = "DEV (vite + uvicorn --reload)" if args.dev else "LIGHT (preview: авто-сборка при изменении src)"
    print(f"Режим: {mode}")
    print(f"Бэкенд: {backend_url}  |  Фронт: {frontend_url}")
    print("Ctrl+C — остановить оба процесса.")

    try:
        while True:
            time.sleep(0.6)
            for i, p in enumerate(procs):
                code = p.poll()
                if code is not None and code != 0:
                    name = f"proc#{i}"
                    print(f"Процесс «{name}» завершился с кодом {code}.", file=sys.stderr)
                    stop_all()
                    return code
                if code == 0:
                    print("Процесс завершился нормально.")
                    stop_all()
                    return 0
    except KeyboardInterrupt:
        print("\nОстановка...")
        stop_all()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
