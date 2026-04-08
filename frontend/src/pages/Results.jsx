import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
import { appStatusLabel, appStatusTitle } from '../lib/statusRu'
import { btnNeutral, btnPrimary, field, fieldInline, link } from '../ui/hover'

export default function Results() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  function fmt(dt) {
    return String(dt || '').replace('T', ' ').slice(0, 19)
  }

  async function load() {
    const { data } = await api.get('/applications', { params: { status: status || undefined, q: q || undefined } })
    setItems(data.items || [])
  }

  useEffect(() => {
    load()
  }, [])

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
            <Hint title="Журнал всех попыток отклика: успех, пропуск с причиной или ошибка. Данные с сервера." />
          </h1>
          <p className="text-slate-400 mt-1" title="Можно отфильтровать и выгрузить в Excel для отчёта.">
            Таблица откликов с фильтрами и экспортом в Excel.
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
          className={`${fieldInline} min-w-[200px]`}
          title="Фильтр по статусу записи в базе: отправлено, пропущено или ошибка."
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Все статусы</option>
          <option value="sent">Отправлено</option>
          <option value="skipped">Пропущено</option>
          <option value="error">Ошибка</option>
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
            {items.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-slate-800 transition-colors hover:bg-slate-800/30 ${
                  r.status === 'sent'
                    ? 'bg-emerald-500/5'
                    : r.status === 'error'
                      ? 'bg-red-500/5'
                      : 'bg-slate-950/10'
                }`}
              >
                <td className="p-3 text-slate-400">{fmt(r.applied_at)}</td>
                <td className="p-3" title={appStatusTitle(r.status)}>
                  {appStatusLabel(r.status)}
                </td>
                <td className="p-3">
                  {r.vacancy_url ? (
                    <a
                      className={link}
                      href={r.vacancy_url}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
