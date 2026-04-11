import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
import { appStatusLabel, appStatusTitle } from '../lib/statusRu'
import { btnNeutral, btnPrimary, field, fieldInline, link } from '../ui/hover'

const HH_VACANCY_BASE = 'https://hh.ru/vacancy'

export default function Results() {
  const [items, setItems] = useState([])
  const [blacklistExtra, setBlacklistExtra] = useState([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  function fmt(dt) {
    return String(dt || '').replace('T', ' ').slice(0, 19)
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 320)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const params = {
          status: status || undefined,
          q: debouncedQ || undefined,
          limit: 400,
        }
        const { data } = await api.get('/applications', { params })
        if (cancelled) return
        setItems(data.items || [])

        // «Все статусы»: отдельно тянем блэклист — в общем merge старые баны могут не попасть в первые N строк
        if (!status) {
          try {
            const { data: blData } = await api.get('/applications', {
              params: {
                status: 'blacklisted',
                q: debouncedQ || undefined,
                limit: 200,
              },
            })
            if (cancelled) return
            const bl = blData.items || []
            const inMain = new Set(
              (data.items || []).filter((i) => i.source === 'blacklist').map((i) => String(i.vacancy_id)),
            )
            setBlacklistExtra(bl.filter((r) => !inMain.has(String(r.vacancy_id))))
          } catch {
            if (!cancelled) setBlacklistExtra([])
          }
        } else {
          setBlacklistExtra([])
        }
      } catch {
        if (!cancelled) {
          setItems([])
          setBlacklistExtra([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status, debouncedQ])

  async function load() {
    try {
      const { data } = await api.get('/applications', {
        params: { status: status || undefined, q: debouncedQ || undefined, limit: 400 },
      })
      setItems(data.items || [])
      if (!status) {
        try {
          const { data: blData } = await api.get('/applications', {
            params: { status: 'blacklisted', q: debouncedQ || undefined, limit: 200 },
          })
          const bl = blData.items || []
          const inMain = new Set(
            (data.items || []).filter((i) => i.source === 'blacklist').map((i) => String(i.vacancy_id)),
          )
          setBlacklistExtra(bl.filter((r) => !inMain.has(String(r.vacancy_id))))
        } catch {
          setBlacklistExtra([])
        }
      } else {
        setBlacklistExtra([])
      }
    } catch {
      setItems([])
      setBlacklistExtra([])
    }
  }

  async function exportXlsx() {
    const res = await api.get('/applications/export', {
      params: { status: status || undefined },
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'otkliki.xlsx'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
            Результаты
            <Hint title="Журнал откликов и записей в блэклисте (автопропуск вакансий). Данные с сервера." />
          </h1>
          <p className="text-slate-400 mt-1" title="Можно отфильтровать и выгрузить в Excel для отчёта.">
            Отклики, пропуски, ошибки и вакансии в блэклисте расширения. Фильтр «В блэклисте» — только бан.
          </p>
        </div>
        <button
          type="button"
          onClick={exportXlsx}
          title="Скачать .xlsx с колонками даты, статуса, вакансии, компании и сообщения об ошибке."
          className={`px-4 py-2 rounded-xl bg-slate-800 text-white ${btnNeutral}`}
        >
          Экспорт в Excel
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className={`${field} max-w-md`}
          placeholder="Поиск по вакансии или компании"
          title="Частичное совпадение по названию вакансии или имени работодателя."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={`${fieldInline} min-w-[220px]`}
          title="Все статусы: общая таблица + блок блэклиста сверху (если есть). «В блэклисте» — только вакансии в бане."
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Все статусы (+ блэклист)</option>
          <option value="sent">Отправлено</option>
          <option value="skipped">Пропущено</option>
          <option value="error">Ошибка</option>
          <option value="blacklisted">Только блэклист</option>
        </select>
        <button
          type="button"
          onClick={load}
          title="Запросить список с текущими фильтрами."
          className={`px-4 py-2 rounded-xl bg-indigo-600 text-white ${btnPrimary}`}
        >
          Применить
        </button>
      </div>

      {status === '' && blacklistExtra.length > 0 && (
        <div className="rounded-2xl border border-amber-900/50 bg-amber-950/20 overflow-hidden">
          <div className="px-4 py-2 text-sm font-medium text-amber-200/95 border-b border-amber-900/40">
            Блэклист расширения ({blacklistExtra.length}) — эти вакансии автоматически пропускаются при автоотклике
          </div>
          <div className="overflow-auto max-h-[min(360px,40vh)]">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-left text-slate-400 text-xs uppercase tracking-wide">
                  <th className="p-2 pl-4">Дата</th>
                  <th className="p-2">Статус</th>
                  <th className="p-2">Вакансия</th>
                  <th className="p-2">Причина</th>
                </tr>
              </thead>
              <tbody>
                {blacklistExtra.map((r) => {
                  const href = r.vacancy_url || (r.vacancy_id ? `${HH_VACANCY_BASE}/${r.vacancy_id}` : null)
                  return (
                    <tr key={`blx-${r.id}`} className="border-t border-amber-900/25 hover:bg-slate-900/40">
                      <td className="p-2 pl-4 text-slate-400 whitespace-nowrap">{fmt(r.applied_at)}</td>
                      <td className="p-2 text-amber-400/95 font-medium" title={appStatusTitle(r.status)}>
                        {appStatusLabel(r.status)}
                      </td>
                      <td className="p-2">
                        {href ? (
                          <a className={link} href={href} target="_blank" rel="noopener noreferrer">
                            {r.vacancy_name || r.vacancy_id}
                          </a>
                        ) : (
                          <span>{r.vacancy_name || r.vacancy_id}</span>
                        )}
                      </td>
                      <td className="p-2 text-slate-400">{r.error_message || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-auto rounded-2xl border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-left text-slate-300">
              <th className="p-3" title="Время записи о событии на сервере.">
                Дата
              </th>
              <th className="p-3" title="Итог обработки вакансии.">
                Статус
              </th>
              <th className="p-3" title="Название позиции со страницы вакансии.">
                Вакансия
              </th>
              <th className="p-3" title="Работодатель из карточки вакансии.">
                Компания
              </th>
              <th className="p-3" title="Почему пропущено или текст ошибки API.">
                Причина / ошибка
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const rowKey = r.source === 'blacklist' ? `bl-${r.id}` : `app-${r.id}`
              const vacancyHref = r.vacancy_url || (r.vacancy_id ? `${HH_VACANCY_BASE}/${r.vacancy_id}` : null)
              return (
              <tr
                key={rowKey}
                className={`border-t border-slate-800 transition-colors hover:bg-slate-800/30 ${
                  r.status === 'sent'
                    ? 'bg-emerald-500/5'
                    : r.status === 'error'
                      ? 'bg-red-500/5'
                      : r.status === 'blacklisted'
                        ? 'bg-amber-500/8'
                        : 'bg-slate-950/10'
                }`}
              >
                <td className="p-3 text-slate-400">{fmt(r.applied_at)}</td>
                <td
                  className={`p-3 font-medium ${r.status === 'sent' ? 'text-green-400' : ''} ${r.status === 'blacklisted' ? 'text-amber-400/95' : ''}`}
                  title={appStatusTitle(r.status)}
                >
                  {appStatusLabel(r.status)}
                </td>
                <td className="p-3">
                  {vacancyHref ? (
                    <a
                      className={link}
                      href={vacancyHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Открыть вакансию на hh.ru в новой вкладке."
                    >
                      {r.vacancy_name || r.vacancy_id}
                    </a>
                  ) : (
                    <span>{r.vacancy_name || r.vacancy_id}</span>
                  )}
                </td>
                <td className="p-3 text-slate-300">{r.company_name || ''}</td>
                <td className="p-3 text-slate-400">{r.skip_reason || r.error_message || ''}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
