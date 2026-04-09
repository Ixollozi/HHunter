# HHunter

Платформа для откликов на hh.ru (MVP): FastAPI + React/Vite. Отклики выполняются через **Chrome-расширение** в браузере; сервер отдаёт API для аккаунта, генерации писем (Groq) и учёта. Установка: [`hhunter-extension/`](hhunter-extension/README.md), в веб-интерфейсе — **«Расширение»**.

## Запуск (локально)

### Один терминал (рекомендуется)

В корне репозитория один раз:

```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy backend\.env.example backend\.env
```

Затем из корня:

```bash
python start.py
```

По умолчанию это **лёгкий режим**: API + `vite preview` со **свежей** сборкой — перед запуском выполняется `npm run build`, если менялись `frontend/src` (или конфиги) и они новее `frontend/dist`. Раньше сборка делалась только при первом появлении `dist/`, из‑за чего UI «застывал».

- Активная вёрстка с горячей перезагрузкой: `python start.py --dev` (Vite dev + при необходимости `--reload` у uvicorn).
- Всегда пересобрать фронт перед preview: `python start.py --force-frontend-build`.
- Пропустить проверку и сборку (быстрый старт со старым `dist`): `python start.py --skip-frontend-build`.

### Отдельно: только API

Из корня (с активированным `.venv`):

```bash
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Отдельно: только фронт

```bash
cd frontend
npm install
npm run dev
```

По умолчанию фронт: `http://localhost:5173`, бэкенд: `http://127.0.0.1:8000`.
