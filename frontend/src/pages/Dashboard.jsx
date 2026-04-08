import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
import { appStatusLabel, appStatusTitle } from '../lib/statusRu'

export default function Dashboard() {
  const [status, setStatus] = useState(null)
  const [apps, setApps] = useState([])
  const [extSettings, setExtSettings] = useState(null)
  const [sentToday, setSentToday] = useState(0)
  const refreshInFlight = useRef(false)
  const progress = useMemo(() => {
    const limit = extSettings?.daily_limit ?? 50
    return { sent: sentToday, limit: limit || 50 }
  }, [extSettings, sentToday])

  async function refresh() {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const { data } = await api.get('/dashboard/summary')
      setStatus(data.status ?? null)
      setApps(data.recent_applications || [])
      setExtSettings(data.extension ?? null)
      setSentToday(data.sent_today?.count ?? 0)
    } finally {
      refreshInFlight.current = false
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const periodMs = 120000
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      refresh()
    }
    const id = setInterval(tick, periodMs)
    const onVis = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const s = status?.session

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
            Главная панель
            <Hint title="Отклики выполняются расширением Chrome на hh.ru. Здесь — прогресс за сегодня (UTC) и последние записи." />
          </h1>
          <div className="text-slate-400 text-sm mt-1">
            Последняя серверная сессия (история): отправлено {s?.total_sent || 0} · пропусков {s?.total_skipped || 0}
            {' '}· ошибок {s?.total_errors || 0}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="https://hh.ru/search/vacancy?text="
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-slate-800 text-white border border-slate-600/80 hover:bg-slate-750 transition-colors"
          >
            Открыть hh.ru
          </a>
          <Link
            to="/extension"
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            Установить расширение
          </Link>
        </div>
      </div>

      {!extSettings ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">
          Не удалось загрузить настройки для расширения. Сохраните параметры в разделе{' '}
          <Link className="underline font-medium" to="/search">
            «Поиск»
          </Link>
          .
        </div>
      ) : null}

      <div
        className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 transition-shadow duration-200 hover:shadow-lg hover:shadow-indigo-500/5"
        title="Отклики сегодня по UTC — в одной зоне с дневным лимитом на сервере."
      >
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-300 flex items-center gap-1 flex-wrap">
            Откликов сегодня (UTC)
            <Hint title="Считаются записи со статусом «отправлено» за календарный день UTC; совпадает с проверкой лимита в расширении." />
          </div>
          <div className="text-sm text-slate-400">
            {progress.sent} / {progress.limit}
          </div>
        </div>
        <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-2 bg-indigo-500 transition-[width] duration-300"
            style={{ width: `${Math.min(100, (progress.sent / (progress.limit || 1)) * 100)}%` }}
          />
        </div>
      </div>

      <div
        className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 transition-shadow duration-200 hover:border-slate-700"
        title="Последние записи из таблицы откликов на сервере."
      >
        <div className="text-sm text-slate-300 mb-3 flex items-center gap-1 flex-wrap">
          Последние 5 откликов
          <Hint title="Данные из расширения. Полный список — в «Результаты»." />
        </div>
        <div className="space-y-2">
          {apps.length === 0 ? (
            <div className="text-sm text-slate-500">
              Пока нет записей — установите расширение и откликнитесь на hh.ru.
            </div>
          ) : (
            apps.map((a) => (
              <div
                key={a.id}
                className="text-sm flex items-center justify-between gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-slate-800/40"
                title={appStatusTitle(a.status)}
              >
                <div className="min-w-0">
                  <div className="truncate text-slate-200">{a.vacancy_name || a.vacancy_id}</div>
                  <div className="truncate text-slate-500">{a.company_name || ''}</div>
                </div>
                <div
                  className={`shrink-0 px-2 py-1 rounded-lg text-xs transition-transform hover:scale-105 ${
                    a.status === 'sent'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : a.status === 'error'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-700/40 text-slate-300'
                  }`}
                >
                  {appStatusLabel(a.status)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  )
}
