import { useEffect, useMemo, useState } from 'react'
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
const COLORS = {
  sent: '#10b981',
  skipped: '#94a3b8',
  error: '#ef4444',
  blacklisted: '#f59e0b',
}

const BAR_LABELS = {
  sent: 'Отправлено',
  skipped: 'Пропущено',
  error: 'Ошибки',
  blacklisted: 'Блэклист',
}

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-slate-200">Дата: {label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="text-slate-300">
          {BAR_LABELS[p.dataKey] || p.dataKey}: <span className="text-white">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const name = p?.name
  const value = p?.value
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl text-slate-200">
      {name}: <span className="text-white font-medium">{value}</span>
    </div>
  )
}

export default function Reports() {
  const [summary, setSummary] = useState(null)
  const [loadError, setLoadError] = useState(null)

  async function load() {
    setLoadError(null)
    try {
      const { data } = await api.get('/reports/summary')
      setSummary(data)
    } catch (e) {
      setSummary(null)
      setLoadError(String(e?.response?.data?.detail || e?.message || e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const tableRows = useMemo(() => {
    const s = summary?.series || []
    return [...s].sort((a, b) => String(b.day).localeCompare(String(a.day)))
  }, [summary])

  const pieData = useMemo(() => {
    const t = summary?.totals
    if (!t) return []
    return [
      { key: 'sent', name: 'Отправлено', value: t.sent || 0 },
      { key: 'skipped', name: 'Пропущено', value: t.skipped || 0 },
      { key: 'error', name: 'Ошибки', value: t.error || 0 },
      { key: 'blacklisted', name: 'Блэклист', value: t.blacklisted || 0 },
    ]
  }, [summary])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Отчёты
          <Hint title="Агрегация по откликам и блэклисту по календарным дням (UTC)." />
        </h1>
        <p className="text-slate-400 mt-1" title="Данные только по вашему аккаунту.">
          Статистика по дням из откликов и блэклиста расширения. Таблица ниже — те же цифры по календарным дням.
        </p>
        {loadError && (
          <p className="mt-2 text-sm text-red-400" title={loadError}>
            Не удалось загрузить отчёт: {loadError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 transition-shadow hover:border-slate-700"
          title="Столбцы: сколько откликов с каждым исходом за календарный день."
        >
          <div className="text-sm text-slate-300 mb-2 flex items-center gap-1 flex-wrap">
            Отклики по дням
            <Hint title="Ось X — дата, Y — количество. Включая записи, попавшие в блэклист в этот день." />
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={summary?.series || []}>
                <XAxis dataKey="day" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<BarTooltip />} />
                <Bar isAnimationActive={false} dataKey="sent" name={BAR_LABELS.sent} fill={COLORS.sent} />
                <Bar isAnimationActive={false} dataKey="skipped" name={BAR_LABELS.skipped} fill={COLORS.skipped} />
                <Bar isAnimationActive={false} dataKey="error" name={BAR_LABELS.error} fill={COLORS.error} />
                <Bar
                  isAnimationActive={false}
                  dataKey="blacklisted"
                  name={BAR_LABELS.blacklisted}
                  fill={COLORS.blacklisted}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 transition-shadow hover:border-slate-700"
          title="Доли исходов за весь доступный период в данных сводки."
        >
          <div className="text-sm text-slate-300 mb-2 flex items-center gap-1 flex-wrap">
            Структура исходов
            <Hint title="Доли исходов откликов и записей блэклиста за весь период в данных." />
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={COLORS[entry.key]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-left text-slate-300">
              <th className="p-3" title="Календарный день (UTC) по дате записи отклика или добавления в блэклист.">
                День (UTC)
              </th>
              <th className="p-3" title="Записи со статусом «отправлено» в журнале откликов.">
                Отправлено
              </th>
              <th className="p-3" title="Пропуски по правилам расширения.">
                Пропущено
              </th>
              <th className="p-3" title="Ошибки при обработке вакансии.">
                Ошибки
              </th>
              <th
                className="p-3 text-amber-200/90"
                title="Сколько вакансий добавлено в блэклист в этот день (расширение перестаёт на них откликаться)."
              >
                Блэклист
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr className="border-t border-slate-800">
                <td colSpan={5} className="p-4 text-slate-500">
                  Нет данных за выбранный период — откликов и записей блэклиста пока нет.
                </td>
              </tr>
            ) : (
              tableRows.map((row) => (
                <tr
                  key={String(row.day)}
                  className="border-t border-slate-800 transition-colors hover:bg-slate-800/25"
                >
                  <td className="p-3 text-slate-300 font-medium whitespace-nowrap">{row.day}</td>
                  <td className="p-3 text-emerald-400/90">{row.sent ?? 0}</td>
                  <td className="p-3 text-slate-300">{row.skipped ?? 0}</td>
                  <td className="p-3 text-red-400/90">{row.error ?? 0}</td>
                  <td className="p-3 text-amber-400/95">{row.blacklisted ?? 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
