# HHunter

Платформа для подготовки и учёта откликов на **HeadHunter** (hh.ru, hh.uz, hh.kz и региональные домены): веб-интерфейс на **React (Vite)** и **FastAPI**, отклики в браузере выполняет **Chrome-расширение** (Manifest V3). Генерация сопроводительных писем — через **Groq** (модель настраивается); ключ API **свой у каждого пользователя**, хранится на сервере в зашифрованном виде при наличии `GROQ_KEY_FERNET_SECRET`.

## Возможности

- **Аккаунты**: регистрация и вход, JWT для API и расширения.
- **Настройки**: ключ Groq, модель, текст резюме (или загрузка PDF), тест ключа.
- **Поиск**: параметры выдачи hh, дневной и почасовой лимит откликов, паузы — расширение подтягивает их через `GET /extension/settings`.
- **Расширение**: открытая вакансия или полный цикл (поиск → карточки → отклик); сбор контактов («Связаться»), ФИО и зарплаты с карточки вакансии; сохранение откликов и черновиков в БД.
- **Результаты**: таблица откликов, фильтры, **экспорт в Excel** (в т.ч. контактный телефон в нормализованном виде, зарплата и контакты при успешном парсинге).
- **Чёрный список вакансий** (например, при отсутствии кнопки отправки на hh).
- **Отчёты**: сводки по дням; **логи** расширения в реальном времени (в т.ч. WebSocket).
- **Диагностика**: нижняя панель на сайте — проверка связи с API и опциональный тест генерации.
- **Скачивание расширения**: `GET /downloads/hhunter-extension.zip` (рядом с каталогом `backend` в деплое должна лежать папка `hhunter-extension`) и страница **«Расширение»** в UI с инструкцией.

Подробнее про расширение: [`hhunter-extension/README.md`](hhunter-extension/README.md).

## Структура репозитория

| Путь | Назначение |
|------|------------|
| `backend/` | FastAPI: auth, settings, extension API, applications, reports, dashboard, загрузка ZIP расширения |
| `frontend/` | SPA (React Router): главная, настройки, поиск, результаты, отчёты, логи, страница расширения |
| `hhunter-extension/` | Chrome-расширение: `content.js`, `background.js`, `popup/` |
| `database/` | SQLite по умолчанию: `hhunter.db` (создаётся при старте) |
| `alembic/` | Миграции схемы БД |
| `start.py` | Один командный запуск фронта и бэкенда |

## Требования

- **Python 3.11+** (рекомендуется), **Node.js** с **npm**
- Аккаунт **Groq** и API key для генерации писем (пользователь вводит в UI после входа)

## Быстрый старт (локально)

В корне репозитория один раз:

```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy backend\.env.example backend\.env
```

Отредактируйте `backend/.env`: обязательно **`JWT_SECRET`**. Для шифрования ключей Groq в БД задайте **`GROQ_KEY_FERNET_SECRET`** (см. комментарии в `.env.example`).

Запуск фронта и API (режим разработки по умолчанию: Vite с HMR + uvicorn `--reload` для `backend/`):

```bash
python start.py --migrate
```

Флаг **`--migrate`** выполняет `alembic upgrade head` перед стартом (рекомендуется).

- Фронт: **http://localhost:5173** (или `http://127.0.0.1:5173`)
- API: **http://127.0.0.1:8000**
- При необходимости задайте **`VITE_API_BASE`** для сборки фронта (см. переменные окружения Vite); по умолчанию в коде часто используется `http://localhost:8000`.

Остановка: **Ctrl+C** в том же терминале.

### Другие режимы `start.py`

- Без HMR, через собранный `dist`: `python start.py --no-dev --migrate`
- Только перезагрузку API отключить: `python start.py --no-reload`
- Пересобрать фронт перед preview: `python start.py --no-dev --force-frontend-build`
- Не пересобирать фронт, если `dist` уже есть: `python start.py --no-dev --skip-frontend-build`

### Только API или только фронт

```bash
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

## Переменные окружения (`backend/.env`)

См. полный пример в [`backend/.env.example`](backend/.env.example). Кратко:

| Переменная | Назначение |
|------------|------------|
| `JWT_SECRET` | Подпись JWT (обязательно сменить в проде) |
| `JWT_EXPIRES_MIN` | Время жизни токена |
| `DB_URL` | По умолчанию SQLite: `database/hhunter.db` в корне репо |
| `FRONTEND_ORIGIN` | Origin фронта для CORS |
| `CORS_EXTRA_ORIGINS` | Дополнительные origin через запятую |
| `GROQ_KEY_FERNET_SECRET` | Fernet-ключ для шифрования Groq API key в БД |
| `HH_API_USER_AGENT` | User-Agent для официального API hh (если используется) |

## Расширение Chrome

1. Войти на сайт HHunter, открыть **«Расширение»** — скачать ZIP или взять папку `hhunter-extension`.
2. `chrome://extensions` → режим разработчика → «Загрузить распакованное» → папка с `manifest.json`.
3. В popup: адрес API (как у `VITE_API_BASE`), код входа с вкладки HHunter.
4. На hh.ru открыть вакансию и запустить цикл из popup.

На продакшене в `hhunter-extension/manifest.json` в **`host_permissions`** добавьте ваши HTTPS-origin фронта и API, если они не localhost.

## Безопасность и данные

- Сессия **hh.ru** в браузере — это cookies **вашего профиля Chrome**; HHunter не подменяет аккаунт на стороне hh.
- JWT в расширении должен соответствовать **вашему** пользователю HHunter — иначе отклики и ключ Groq учитываются в чужом аккаунте.

## Лицензия и правила hh

Соблюдайте правила HeadHunter, разумные паузы и лимиты; массовые автоматические действия могут привести к капче или блокировкам.
