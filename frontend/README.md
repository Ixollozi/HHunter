# HHunter Frontend (React + Vite)

SPA для HHunter: страницы **Настройки**, **Поиск**, **Результаты**, **Логи**, **Отчёты**, **Расширение**.

Фронт работает вместе с API из `backend/`.

## Требования

- Node.js + npm
- Запущенный API HHunter (FastAPI)

## Переменные окружения

### `VITE_API_BASE`

Базовый URL API. Примеры:

- `http://127.0.0.1:8000`
- `https://your-domain/api`

Если переменная не задана, проект обычно использует `http://localhost:8000`.

Windows PowerShell (на текущую сессию):

```bash
$env:VITE_API_BASE="http://127.0.0.1:8000"
npm run dev
```

## Запуск (dev)

Из папки `frontend/`:

```bash
npm install
npm run dev
```

Vite поднимет сайт (обычно `http://localhost:5173`).

## Сборка (prod build)

```bash
npm run build
npm run preview
```

В режиме preview используется `dist/` (без HMR).

## Запуск всего проекта одной командой

В корне репозитория есть скрипт старта, который поднимает **API + фронт**:

- `python start.py --migrate` — dev режим (vite dev + uvicorn reload)
- `python start.py --migrate --no-dev` — light режим (vite preview, `dist` пересобирается если `src/` новее)

Подробности — в корневом `README.md` и в `start.py`.

## Расширение Chrome

Инструкция по установке расширения:

- в UI: страница `/extension`
- в репозитории: `hhunter-extension/README.md`

Коротко: расширение скачивается с API (`GET /downloads/hhunter-extension.zip`), распаковывается и ставится через `chrome://extensions` → режим разработчика → «Загрузить распакованное».

## Установка “в один клик” для Windows

Если HHunter запускают на компьютере пользователя, в корне репозитория есть установщик:

- `HHunter-Setup.cmd` — проверит Python/Node (через winget), создаст `.venv`, поставит зависимости и запустит проект.
