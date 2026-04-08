import { useEffect, useMemo, useState } from 'react'
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
import { sessionStatusLabel } from '../lib/statusRu'

const COLORS = {
  sent: '#10b981',
  skipped: '#94a3b8',
  error: '#ef4444',
}

const BAR_LABELS = {
  sent: 'Отправлено',
  skipped: 'Пропущено',
  error: 'Ошибки',
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
  const [sessions, setSessions] = useState([])

  function fmt(dt) {
    return String(dt || '').replace('T', ' ').slice(0, 19)
  }

  async function load() {
    const s = await api.get('/reports/summary')
    const ss = await api.get('/reports/sessions')
    setSummary(s.data)
    setSessions(ss.data.items || [])
  }

  useEffect(() => {
    load()
  }, [])

  const pieData = useMemo(() => {
    const t = summary?.totals
    if (!t) return []
    return [
      { key: 'sent', name: 'Отправлено', value: t.sent || 0 },
      { key: 'skipped', name: 'Пропущено', value: t.skipped || 0 },
      { key: 'error', name: 'Ошибки', value: t.error || 0 },
    ]
  }, [summary])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Отчёты
          <Hint title="Агрегация по таблице откликов и журналу сессий: для оценки объёмов и сбоев по дням." />
        </h1>
        <p className="text-slate-400 mt-1" title="Данные только по вашему аккаунту.">
          Статистика по дням и история запусков сессий.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 transition-shadow hover:border-slate-700"
          title="Столбцы: сколько откликов с каждым исходом за календарный день."
        >
          <div className="text-sm text-slate-300 mb-2 flex items-center gap-1 flex-wrap">
            Отклики по дням
            <Hint title="Ось X — дата, Y — количество. Три категории совпадают с фильтром в «Результатах»." />
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
            <Hint title="Круговая диаграмма: доля отправленных, пропущенных и ошибочных откликов от общего числа в выборке." />
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
              <th className="p-3" title="Когда была запущена сессия автооткликов.">
                Начало
              </th>
              <th className="p-3" title="Состояние на момент последнего обновления записи.">
                Статус
              </th>
              <th className="p-3" title="Сколько вакансий вернул поиск по первой странице выдачи (как в ответе API).">
                Найдено (API)
              </th>
              <th className="p-3" title="Успешные отклики за сессию.">
                Отправлено
              </th>
              <th className="p-3" title="Пропуски по правилам (уже откликались, direct, тест и т.д.).">
                Пропущено
              </th>
              <th className="p-3" title="Сбои при генерации или запросе к API.">
                Ошибки
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr
                key={s.id}
                className="border-t border-slate-800 transition-colors hover:bg-slate-800/25"
                title={`Сессия #${s.id}`}
              >
                <td className="p-3 text-slate-400">{fmt(s.started_at)}</td>
                <td className="p-3">{sessionStatusLabel(s.status)}</td>
                <td className="p-3">{s.total_found}</td>
                <td className="p-3">{s.total_sent}</td>
                <td className="p-3">{s.total_skipped}</td>
                <td className="p-3">{s.total_errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
