import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { clearToken, isAuthed } from '../lib/auth'
import { AppDiagnosticsPanel } from './AppDiagnosticsPanel'
import { navLink } from '../ui/hover'

function NavItem({ to, children, title }) {
  return (
    <NavLink
      to={to}
      title={title}
      className={({ isActive }) =>
        `${navLink} ${isActive ? 'bg-slate-800 text-white ring-1 ring-slate-600/40' : 'text-slate-300'}`
      }
    >
      {children}
    </NavLink>
  )
}

export function Layout() {
  const nav = useNavigate()

  function onLogout() {
    clearToken()
    nav('/login')
  }

  const authed = isAuthed()

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <Link
            to="/"
            title="HHunter — настройки, расширение и учёт откликов."
            className="font-semibold tracking-tight text-white transition-colors duration-200 hover:text-indigo-300"
          >
            HHunter
          </Link>
          {authed ? (
            <>
              <nav className="ml-4 flex flex-wrap gap-2">
                <NavItem
                  to="/"
                  title="Обзор: расширение для откликов, прогресс за день, последние записи, проверка сервиса."
                >
                  Главная
                </NavItem>
                <NavItem
                  to="/extension"
                  title="Как установить Chrome-расширение HHunter для работы на hh.ru."
                >
                  Расширение
                </NavItem>
                <NavItem
                  to="/settings"
                  title="Ключ Groq и текст резюме для генерации писем."
                >
                  Настройки
                </NavItem>
                <NavItem
                  to="/search"
                  title="Фильтры и лимиты для расширения (паузы, дневной лимит) и заметки по поиску."
                >
                  Поиск
                </NavItem>
                <NavItem
                  to="/results"
                  title="Таблица всех откликов: фильтры, поиск, выгрузка в Excel."
                >
                  Результаты
                </NavItem>
                <NavItem
                  to="/reports"
                  title="Графики и сводка по дням, доля отправлено/пропуски/ошибки, история сессий."
                >
                  Отчёты
                </NavItem>
              </nav>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={onLogout}
                  title="Выйти из аккаунта: токен удалится из браузера, потребуется войти снова."
                  className="px-3 py-2 rounded-lg text-sm bg-slate-800 transition-all duration-200 hover:bg-red-900/50 hover:text-red-100 hover:ring-1 hover:ring-red-500/40 active:scale-[0.98]"
                >
                  Выйти
                </button>
              </div>
            </>
          ) : (
            <div className="ml-auto flex gap-2">
              <NavItem to="/login" title="Вход по логину и паролю, выдаётся JWT для запросов к API.">
                Вход
              </NavItem>
              <NavItem to="/register" title="Создать аккаунт: логин (username) и пароль; сразу выдаётся JWT.">
                Регистрация
              </NavItem>
            </div>
          )}
        </div>
      </header>

      <main className={`mx-auto max-w-6xl px-4 py-6 ${authed ? 'pb-28' : ''}`}>
        <Outlet />
      </main>
      {authed ? <AppDiagnosticsPanel /> : null}
    </div>
  )
}
