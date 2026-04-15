import { useCallback, useEffect, useState } from 'react'
import { apiBaseUrl } from '../lib/api'
import { getToken } from '../lib/auth'
import { btnNeutral, btnPrimary } from '../ui/hover'

const SEARCH_LABELS = {
  search_text: 'Текст поиска',
  search_fields: 'Поля поиска',
  area: 'Регион',
  experience: 'Опыт',
  employment: 'Тип занятости',
  schedule: 'График',
  period: 'Период',
  salary: 'Зарплата',
  only_with_salary: 'Только с зарплатой',
  order_by: 'Сортировка',
  delay_min: 'Пауза мин., с',
  delay_max: 'Пауза макс., с',
  daily_limit: 'Лимит в день',
}

const DIAG_LETTER_KEY = 'hhunter_diag_include_letter'
const DIAG_LETTER_MODE_KEY = 'hhunter_diag_letter_mode'
const DIAG_BAR_HIDDEN_KEY = 'hhunter_diag_bar_hidden'

function formatSearchValue(v) {
  if (v == null || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  return String(v)
}

function readBarHidden() {
  try {
    return localStorage.getItem(DIAG_BAR_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function AppDiagnosticsPanel() {
  const [barHidden, setBarHidden] = useState(readBarHidden)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [liveLog, setLiveLog] = useState([])
  const [liveStep, setLiveStep] = useState('')
  const [includeLetterDemo, setIncludeLetterDemo] = useState(() => {
    try {
      return sessionStorage.getItem(DIAG_LETTER_KEY) === '1'
    } catch {
      return false
    }
  })
  const [letterMode, setLetterMode] = useState(() => {
    try {
      const raw = sessionStorage.getItem(DIAG_LETTER_MODE_KEY)
      return raw === 'custom' ? 'custom' : 'ai'
    } catch {
      return 'ai'
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(DIAG_LETTER_KEY, includeLetterDemo ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [includeLetterDemo])

  useEffect(() => {
    try {
      sessionStorage.setItem(DIAG_LETTER_MODE_KEY, letterMode === 'custom' ? 'custom' : 'ai')
    } catch {
      /* ignore */
    }
  }, [letterMode])

  const run = useCallback(async ({ includeLetter, mode } = {}) => {
    setErr('')
    setLoading(true)
    setLiveLog([])
    setLiveStep('Запуск…')
    try {
      const token = getToken()
      const inc = includeLetter != null ? !!includeLetter : !!includeLetterDemo
      const m = mode || letterMode || 'ai'
      const q = inc ? `?include_letter=true${m === 'custom' ? '&letter_mode=custom' : ''}` : ''
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/diagnostics/run-stream${q}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder('utf-8')
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line) continue
          let evt
          try {
            evt = JSON.parse(line)
          } catch {
            continue
          }
          if (evt.stage === 'step') {
            setLiveStep(String(evt.message || ''))
          }
          if (evt.stage === 'check') {
            const c = evt.check
            if (c?.label) {
              setLiveLog((p) => [...p, `${evt.t_ms}ms · ${c.ok ? 'OK' : c.skipped ? 'SKIP' : 'FAIL'} · ${c.label}`])
            }
            // partial updates
            setData((prev) => ({
              ...(prev || {}),
              ...(evt.search_snapshot ? { search_snapshot: evt.search_snapshot } : null),
              ...(evt.vacancy_preview ? { vacancy_preview: evt.vacancy_preview } : null),
              ...(evt.vacancy_preview_web ? { vacancy_preview_web: evt.vacancy_preview_web } : null),
              ...(evt.vacancy_preview_api ? { vacancy_preview_api: evt.vacancy_preview_api } : null),
              ...(evt.letter_demo ? { letter_demo: evt.letter_demo } : null),
              ...(evt.check ? { checks: [...((prev?.checks || [])), evt.check] } : null),
            }))
          }
          if (evt.stage === 'final') {
            setLiveStep('Готово')
            setData(evt.data)
          }
        }
      }
    } catch (e) {
      const detail = e.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((x) => x.msg || x).join('; ')
            : e.message || 'Ошибка запроса'
      setErr(String(msg))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [includeLetterDemo, letterMode])

  function openPanel() {
    setOpen(true)
    setCopied(false)
    run()
  }

  function openPanelWithCustomLetter() {
    setOpen(true)
    setCopied(false)
    // запускаем без гонок setState
    setIncludeLetterDemo(true)
    setLetterMode('custom')
    run({ includeLetter: true, mode: 'custom' })
  }

  function closePanel() {
    setOpen(false)
    setErr('')
    setData(null)
    setCopied(false)
  }

  function hideBottomBar() {
    setBarHidden(true)
    try {
      localStorage.setItem(DIAG_BAR_HIDDEN_KEY, '1')
    } catch {
      /* ignore */
    }
    closePanel()
  }

  function showBottomBar() {
    setBarHidden(false)
    try {
      localStorage.removeItem(DIAG_BAR_HIDDEN_KEY)
    } catch {
      /* ignore */
    }
  }

  async function copyLetter() {
    const text = data?.letter_demo?.letter
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const letter = data?.letter_demo
  const vacancyWeb = data?.vacancy_preview_web?.vacancy || null
  const vacancyApi = data?.vacancy_preview_api?.vacancy || null
  const vacancyAny =
    data?.vacancy_preview?.vacancy ||
    data?.letter_demo?.vacancy ||
    vacancyWeb ||
    vacancyApi ||
    null
  const summaryOk = data?.extra?.summary_ok
  const checks = data?.checks ?? []
  const snap = data?.search_snapshot

  return (
    <>
      <div
        className={`fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur shadow-[0_-8px_30px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-in-out motion-reduce:transition-none ${
          barHidden ? 'translate-y-full pointer-events-none' : 'translate-y-0'
        }`}
        aria-hidden={barHidden}
      >
        <div className="relative mx-auto max-w-6xl px-4 pt-2 pb-3">
          <button
            type="button"
            onClick={hideBottomBar}
            title="Скрыть панель проверки"
            aria-label="Скрыть панель проверки"
            className={`absolute right-2 top-1 z-10 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-800/90 hover:text-slate-200 ${btnNeutral}`}
          >
            <span className="sr-only">Скрыть</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className="flex flex-col gap-3 pr-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:pr-12">
          <p className="text-sm text-slate-400 min-w-0 sm:max-w-xl">
            Проверка: настройки, поиск и hh.ru без расхода Groq. Отклик на вакансию не отправляется.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 w-full sm:w-auto">
            <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 cursor-pointer select-none w-fit max-w-full">
              <input
                type="checkbox"
                checked={includeLetterDemo}
                onChange={(e) => {
                  const on = e.target.checked
                  setIncludeLetterDemo(on)
                  if (on) setLetterMode('ai')
                }}
                className="h-4 w-4 shrink-0 rounded border-slate-500 bg-slate-950 accent-indigo-500"
              />
              <span>
                Сгенерировать демо-письмо (Groq)
                <span className="block text-xs font-normal text-slate-500">+1 запрос к Groq, иначе без модели</span>
              </span>
            </label>
            <button
              type="button"
              onClick={openPanelWithCustomLetter}
              disabled={loading && open}
              title="Запустить тест и собрать письмо из вашего шаблона (Настройки → «Использовать своё письмо»). Groq не используется."
              className={`shrink-0 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800/80 disabled:opacity-60 w-full sm:w-auto ${btnNeutral}`}
            >
              Использовать своё письмо
            </button>
            <button
              type="button"
              onClick={openPanel}
              disabled={loading && open}
              className={`shrink-0 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 w-full sm:w-auto ${btnPrimary}`}
            >
              {loading && open ? 'Проверка…' : 'Протестировать приложение'}
            </button>
          </div>
          </div>
        </div>
      </div>

      {barHidden ? (
        <button
          type="button"
          onClick={showBottomBar}
          title="Показать панель проверки приложения"
          className={`fixed bottom-0 left-1/2 z-40 -translate-x-1/2 rounded-t-lg border border-b-0 border-slate-700/90 bg-slate-900/95 px-4 py-2 text-xs font-medium text-slate-400 shadow-lg backdrop-blur-sm transition-colors hover:border-slate-600 hover:text-slate-200 ${btnNeutral}`}
        >
          Проверка приложения
          <span className="ml-1.5 inline-block translate-y-px" aria-hidden>
            ▲
          </span>
        </button>
      ) : null}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 bg-slate-950/75 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diag-panel-title"
          onClick={(e) => e.target === e.currentTarget && closePanel()}
        >
          <div
            className="flex max-h-[min(92vh,760px)] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-700/90 bg-slate-900 shadow-2xl shadow-black/50 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4 shrink-0">
              <div>
                <h2 id="diag-panel-title" className="text-lg font-semibold text-slate-50">
                  Проверка приложения
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {data?.ran_at ? `Запуск: ${data.ran_at}` : ' '}
                  {summaryOk != null && data?.ran_at ? ' · ' : ''}
                  {summaryOk != null ? (
                    <span className={summaryOk ? 'text-emerald-400' : 'text-amber-400'}>
                      {summaryOk ? 'Критические пункты в порядке' : 'Есть замечания'}
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className={`rounded-lg px-2.5 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white ${btnNeutral}`}
              >
                Закрыть
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {err ? (
                <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {err}
                </div>
              ) : null}

              {loading && !data ? (
                <div className="text-sm text-slate-400">Выполняется проверка…</div>
              ) : null}
              {liveStep ? (
                <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                  <div className="text-xs text-slate-500 mb-1">Текущий шаг</div>
                  {liveStep}
                </div>
              ) : null}
              {liveLog.length ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3">
                  <div className="text-xs text-slate-500 mb-2">Логи теста (в реальном времени)</div>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap max-h-40 overflow-auto">{liveLog.join('\n')}</pre>
                </div>
              ) : null}

              {checks.length > 0 ? (
                <section className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-indigo-400/90">Чеклист</div>
                  <ul className="space-y-2">
                    {checks.map((c, i) => (
                      <li
                        key={`${c.id}-${i}`}
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          c.skipped
                            ? 'border-slate-700/60 bg-slate-950/40 text-slate-400'
                            : c.ok
                              ? 'border-emerald-500/25 bg-emerald-500/5 text-slate-200'
                              : 'border-amber-500/30 bg-amber-500/5 text-amber-100'
                        }`}
                      >
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                              c.skipped ? 'bg-slate-500' : c.ok ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          {c.label}
                          {c.skipped ? <span className="text-xs text-slate-500">(пропуск)</span> : null}
                        </div>
                        {c.detail ? <div className="text-xs text-slate-400 mt-1">{c.detail}</div> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {snap ? (
                <section className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-indigo-400/90">
                    Снимок параметров поиска
                  </div>
                  <dl className="rounded-xl border border-slate-700/80 bg-slate-950/50 divide-y divide-slate-800/80 text-sm">
                    {Object.entries(SEARCH_LABELS).map(([key, label]) => (
                      <div key={key} className="flex gap-3 px-3 py-2 justify-between">
                        <dt className="text-slate-500 shrink-0">{label}</dt>
                        <dd className="text-slate-200 text-right min-w-0 break-words">{formatSearchValue(snap[key])}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : (
                !loading &&
                data && (
                  <div className="text-sm text-slate-500">Нет сохранённых параметров поиска — раздел «Поиск».</div>
                )
              )}

              <section className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-indigo-400/90">Доступные модели Groq</div>
                <div className="rounded-xl border border-slate-700/80 bg-slate-950/40 px-4 py-3 text-sm text-slate-300 space-y-1">
                  <div>
                    ⭐ <span className="text-slate-100 font-medium">Qwen3 32B</span> — <code className="text-slate-200">qwen/qwen3-32b</code>
                  </div>
                  <div>
                    <span className="text-slate-100 font-medium">Llama 3.3 70B</span> — <code className="text-slate-200">llama-3.3-70b-versatile</code>
                  </div>
                  <div>
                    <span className="text-slate-100 font-medium">Llama 4 Scout</span> — <code className="text-slate-200">llama-4-scout-instruct</code>
                  </div>
                  <div>
                    <span className="text-slate-100 font-medium">Llama 3.1 8B</span> — <code className="text-slate-200">llama-3.1-8b-instant</code>
                  </div>
                  <div className="text-xs text-slate-500 pt-1">
                    Модель выбирается в разделе «Настройки».
                  </div>
                </div>
              </section>

              {vacancyAny ? (
                <section className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-3 space-y-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-indigo-400/90">
                    Вакансия с hh (по вашему поиску)
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {vacancyWeb ? (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                        <div className="text-xs text-slate-500 mb-1">Источник: web‑выдача (HTML)</div>
                        <div className="text-base font-medium text-slate-100">{vacancyWeb.title}</div>
                        <div className="text-sm text-slate-400">{vacancyWeb.company_name}</div>
                        {vacancyWeb.hh_url ? (
                          <a
                            href={vacancyWeb.hh_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Открыть эту вакансию на hh"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 underline-offset-4 hover:underline mt-1"
                          >
                            Открыть вакансию
                            <span aria-hidden className="text-slate-500 text-xs font-normal">
                              (новая вкладка)
                            </span>
                          </a>
                        ) : null}
                        <p className="text-sm text-slate-300 leading-relaxed line-clamp-4 sm:line-clamp-none mt-2">
                          {vacancyWeb.description}
                        </p>
                        {Array.isArray(vacancyWeb.skills) && vacancyWeb.skills.length ? (
                          <div className="flex flex-wrap gap-1.5 pt-2">
                            {vacancyWeb.skills.map((sk) => (
                              <span
                                key={`w-${sk}`}
                                className="rounded-md bg-slate-800/80 px-2 py-0.5 text-xs text-slate-300 border border-slate-700/60"
                              >
                                {sk}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {vacancyApi ? (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                        <div className="text-xs text-slate-500 mb-1">Источник: API hh.ru (резерв)</div>
                        <div className="text-base font-medium text-slate-100">{vacancyApi.title}</div>
                        <div className="text-sm text-slate-400">{vacancyApi.company_name}</div>
                        {vacancyApi.hh_url ? (
                          <a
                            href={vacancyApi.hh_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Открыть эту вакансию на hh"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 underline-offset-4 hover:underline mt-1"
                          >
                            Открыть вакансию
                            <span aria-hidden className="text-slate-500 text-xs font-normal">
                              (новая вкладка)
                            </span>
                          </a>
                        ) : null}
                        <p className="text-sm text-slate-300 leading-relaxed line-clamp-4 sm:line-clamp-none mt-2">
                          {vacancyApi.description}
                        </p>
                        {Array.isArray(vacancyApi.skills) && vacancyApi.skills.length ? (
                          <div className="flex flex-wrap gap-1.5 pt-2">
                            {vacancyApi.skills.map((sk) => (
                              <span
                                key={`a-${sk}`}
                                className="rounded-md bg-slate-800/80 px-2 py-0.5 text-xs text-slate-300 border border-slate-700/60"
                              >
                                {sk}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!vacancyWeb && !vacancyApi && vacancyAny ? (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                        <div className="text-xs text-slate-500 mb-1">Источник: —</div>
                        <div className="text-base font-medium text-slate-100">{vacancyAny.title}</div>
                        <div className="text-sm text-slate-400">{vacancyAny.company_name}</div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {letter?.letter != null ? (
                <section className="space-y-2">
                  <div
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                      letter.validation_ok
                        ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25'
                        : 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25'
                    }`}
                  >
                    Проверка текста: {letter.validation_message || '—'}
                  </div>
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
                    <div className="text-xs text-slate-500 mb-2">Сопроводительное письмо</div>
                    <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{letter.letter}</p>
                  </div>
                </section>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-5 py-3 shrink-0">
              <button
                type="button"
                onClick={() => run()}
                disabled={loading}
                className={`rounded-xl bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50 ${btnNeutral}`}
              >
                {loading ? 'Обновление…' : 'Повторить проверку'}
              </button>
              {letter?.letter ? (
                <button
                  type="button"
                  onClick={copyLetter}
                  className={`rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 ${btnNeutral}`}
                >
                  {copied ? 'Скопировано' : 'Копировать письмо'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
