import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'

function normLevel(level) {
  return String(level ?? '')
    .trim()
    .toUpperCase()
    .replace(/\u00a0/g, '')
}

function levelClass(level) {
  const u = normLevel(level)
  if (u === 'ERROR' || u === 'CRITICAL') return 'text-red-300 bg-red-500/10'
  if (u === 'WARNING') return 'text-amber-200 bg-amber-500/10'
  if (u === 'SUCCESS') return 'log-badge-success'
  return 'text-slate-300 bg-slate-800/40'
}

function formatTs(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

/** Не рендерить объект/array из FastAPI как React-child (белый экран). */
function formatAxiosDetail(e) {
  if (!e || typeof e !== 'object') return 'Ошибка загрузки'
  const d = e.response?.data?.detail
  if (d == null) return e.message || 'Ошибка загрузки'
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d
      .map((x) => (x && typeof x === 'object' && x.msg != null ? String(x.msg) : JSON.stringify(x)))
      .join('; ')
  }
  if (typeof d === 'object') return d.message != null ? String(d.message) : JSON.stringify(d)
  return String(d)
}

/** Один id — одна строка; порядок сохраняем (первое вхождение остаётся — сверху свежее). */
function dedupeLogsById(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const id = r?.id
    if (id == null || seen.has(id)) continue
    seen.add(id)
    out.push(r)
  }
  return out
}

export default function Logs() {
  const [items, setItems] = useState([])
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const maxIdRef = useRef(0)
  const listRef = useRef(null)
  /** Не запускать второй запрос, пока первый не завершился — иначе гонки и дубли в state. */
  const busyRef = useRef(false)
  /** Пользователь у верха списка — после появления новых строк прокрутим к началу (свежие сверху). */
  const stickTopRef = useRef(true)

  const refresh = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const since = maxIdRef.current
      const params = since > 0 ? { since_id: since, limit: 300 } : { limit: 400 }
      const { data } = await api.get('/dashboard/activity-logs', { params })
      const list = dedupeLogsById(Array.isArray(data?.items) ? data.items : [])
      setErr(null)
      if (!list.length) {
        if (since === 0) setItems([])
        return
      }
      if (since === 0) {
        setItems(list)
        maxIdRef.current = list.reduce((m, r) => Math.max(m, r.id), 0)
      } else {
        setItems((prev) => {
          const dedupedPrev = dedupeLogsById(prev)
          const seen = new Set(dedupedPrev.map((x) => x.id))
          const merged = list.filter((r) => !seen.has(r.id))
          if (!merged.length) return dedupedPrev
          return dedupeLogsById([...merged, ...dedupedPrev])
        })
        maxIdRef.current = Math.max(maxIdRef.current, ...list.map((r) => r.id))
      }
    } catch (e) {
      setErr(formatAxiosDetail(e))
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    maxIdRef.current = 0
    setItems([])
    refresh()
    const id = setInterval(refresh, 1500)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const el = listRef.current
    if (el && stickTopRef.current) {
      el.scrollTop = 0
    }
  }, [items])

  async function clearLogs() {
    if (
      !window.confirm(
        'Удалить все записи журнала расширения для вашего аккаунта? Действие необратимо.',
      )
    ) {
      return
    }
    setClearing(true)
    setErr(null)
    try {
      await api.delete('/dashboard/activity-logs')
      busyRef.current = false
      maxIdRef.current = 0
      setItems([])
      setLoading(true)
      await refresh()
    } catch (e) {
      setErr(formatAxiosDetail(e))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
            Логи расширения
            <Hint title="Сообщения с шагами автопоиска и полуавтомата приходят с расширения Chrome на сервер (POST /extension/log). Обновление раз в ~1.5 с." />
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Поток в реальном времени (опрос API ~1.5 с). Откройте эту вкладку во время работы расширения на hh.ru /
            hh.uz. Сверху — свежие события; «С начала» перезагружает список с сервера.
          </p>
        </div>
        {/* Отдельная строка: иначе при flex + длинном тексте вторая кнопка уезжает за край или в обрезку */}
        <div
          className="flex flex-row flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Действия с журналом"
        >
          <button
            type="button"
            onClick={() => {
              busyRef.current = false
              maxIdRef.current = 0
              setItems([])
              setLoading(true)
              setErr(null)
              refresh()
            }}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-slate-600/80 hover:bg-slate-750 text-sm whitespace-nowrap"
          >
            С начала
          </button>
          <button
            type="button"
            disabled={clearing}
            onClick={() => void clearLogs()}
            title="Удалить все строки журнала на сервере для текущего пользователя"
            className="px-4 py-2 rounded-xl text-sm whitespace-nowrap border border-red-500/60 bg-red-900/85 text-white hover:bg-red-800/90 disabled:cursor-wait disabled:opacity-80"
          >
            {clearing ? 'Очистка…' : 'Очистить логи'}
          </button>
        </div>
      </header>

      {err ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200 text-sm whitespace-pre-wrap">
          {err}
          <div className="mt-2 text-red-300/80 text-xs">
            Проверьте, что API запущен и в БД есть таблица activity_logs (перезапустите бэкенд после обновления кода).
          </div>
        </div>
      ) : null}

      <div
        ref={listRef}
        onScroll={(e) => {
          const t = e.target
          stickTopRef.current = t.scrollTop < 72
        }}
        className="rounded-2xl border border-slate-800 bg-slate-950/50 font-mono text-xs max-h-[70vh] overflow-y-auto"
      >
        {loading ? (
          <div className="p-6 text-slate-400">Загрузка журнала…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-slate-500">Пока нет записей — запустите расширение с сохранённым токеном.</div>
        ) : (
          <ul className="divide-y divide-slate-800/80">
            {items.map((row) => (
              <li key={row.id} className="px-3 py-2 flex gap-3 items-start hover:bg-slate-900/60">
                <span className="shrink-0 text-slate-500 w-36 tabular-nums">{formatTs(row.created_at)}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded ${levelClass(row.level)}`}>{row.level}</span>
                <span className="shrink-0 text-slate-500 w-28 truncate" title={row.source || ''}>
                  {row.source || '—'}
                </span>
                <span className="shrink-0 text-indigo-300/90 w-40 truncate" title={row.step || ''}>
                  {row.step || '—'}
                </span>
                <span className="min-w-0 text-slate-200 whitespace-pre-wrap break-words">{row.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
