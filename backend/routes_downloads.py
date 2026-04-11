from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter(prefix="/downloads", tags=["downloads"])

_REPO_ROOT = Path(__file__).resolve().parent.parent
_EXTENSION_DIR = _REPO_ROOT / "hhunter-extension"

_SKIP_NAMES = frozenset({".DS_Store", "Thumbs.db"})
_SKIP_DIR_PREFIXES = (".",)


def _iter_pack_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    out: list[Path] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.name in _SKIP_NAMES:
            continue
        if "__pycache__" in p.parts:
            continue
        try:
            rel = p.relative_to(root)
        except ValueError:
            continue
        if any(part.startswith(_SKIP_DIR_PREFIXES) for part in rel.parts):
            continue
        out.append(p)
    return sorted(out, key=lambda x: str(x).lower())


def _extension_version() -> str:
    manifest = _EXTENSION_DIR / "manifest.json"
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        v = data.get("version")
        if isinstance(v, str) and v.strip():
            return v.strip()
    except OSError | json.JSONDecodeError | TypeError:
        pass
    return "0"


@router.get("/hhunter-extension.zip")
def download_hhunter_extension_zip() -> Response:
    """Сборка папки hhunter-extension в zip для установки в Chrome «Загрузить распакованное»."""
    if not _EXTENSION_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Папка расширения на сервере не найдена.")

    files = _iter_pack_files(_EXTENSION_DIR)
    if not files:
        raise HTTPException(status_code=404, detail="Нет файлов для архива расширения.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            arc = path.relative_to(_EXTENSION_DIR).as_posix()
            zf.write(path, arcname=f"hhunter-extension/{arc}")

    data = buf.getvalue()
    version = _extension_version()

    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="hhunter-extension-{version}.zip"',
            "Cache-Control": "public, max-age=3600",
        },
    )
