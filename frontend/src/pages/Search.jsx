import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
import { btnPrimary, btnNeutral, field } from '../ui/hover'

const EXPERIENCE_OPTIONS = [
  { code: '', label: 'Любой' },
  { code: 'noExperience', label: 'Нет опыта' },
  { code: 'between1And3', label: 'От 1 до 3 лет' },
  { code: 'between3And6', label: 'От 3 до 6 лет' },
  { code: 'moreThan6', label: 'Более 6 лет' },
]

const EMPLOYMENT_OPTIONS = [
  { code: 'full', label: 'Полная занятость' },
  { code: 'part', label: 'Частичная занятость' },
  { code: 'project', label: 'Проектная работа' },
  { code: 'volunteer', label: 'Волонтёрство' },
  { code: 'probation', label: 'Стажировка' },
]

const SCHEDULE_OPTIONS = [
  { code: 'fullDay', label: 'Полный день' },
  { code: 'shift', label: 'Сменный график' },
  { code: 'flexible', label: 'Гибкий график' },
  { code: 'remote', label: 'Удалённая работа' },
  { code: 'flyInFlyOut', label: 'Вахтовый метод' },
]

const PERIOD_OPTIONS = [
  { value: 1, label: 'За сегодня' },
  { value: 3, label: 'За 3 дня' },
  { value: 7, label: 'За неделю' },
  { value: 14, label: 'За 2 недели' },
  { value: 30, label: 'За месяц' },
]

const ORDER_BY_OPTIONS = [
  { code: 'relevance', label: 'По релевантности' },
  { code: 'publication_time', label: 'По дате публикации' },
  { code: 'salary_desc', label: 'По убыванию зарплаты' },
  { code: 'salary_asc', label: 'По возрастанию зарплаты' },
]

/** Поля текстового поиска (коды для сохранения в профиле) */
const SEARCH_FIELD_OPTIONS = [
  { code: 'name', label: 'В названии вакансии' },
  { code: 'description', label: 'В описании вакансии' },
  { code: 'company_name', label: 'В названии компании' },
]

const DEFAULT_SEARCH_FIELDS = ['name', 'description', 'company_name']

/** Популярные города — быстрый выбор (типичные id регионов для поиска на сайтах вакансий) */
const TOP_AREAS = [
  { id: '1', name: 'Москва' },
  { id: '2', name: 'Санкт-Петербург' },
  { id: '3', name: 'Екатеринбург' },
  { id: '4', name: 'Новосибирск' },
  { id: '66', name: 'Нижний Новгород' },
  { id: '76', name: 'Ростов-на-Дону' },
  { id: '88', name: 'Казань' },
  { id: '97', name: 'Уфа' },
  { id: '54', name: 'Краснодар' },
  { id: '2748', name: 'Ташкент' },
]

function defaultForm() {
  return {
    search_text: '',
    search_fields: [...DEFAULT_SEARCH_FIELDS],
    area: '',
    experience: '',
    employment: [],
    schedule: [],
    period: 7,
    salary: '',
    only_with_salary: false,
    order_by: 'publication_time',
    delay_min: 2,
    delay_max: 6,
    daily_limit: 200,
  }
}

function normalizeLoadedSearch(s) {
  const base = { ...defaultForm(), ...s }
  if (s.search_fields == null || !Array.isArray(s.search_fields)) {
    base.search_fields = [...DEFAULT_SEARCH_FIELDS]
  } else {
    base.search_fields = [...s.search_fields]
  }
  base.employment = Array.isArray(base.employment) ? base.employment : []
  base.schedule = Array.isArray(base.schedule) ? base.schedule : []
  base.only_with_salary = !!base.only_with_salary
  base.salary = base.salary != null && base.salary !== '' ? base.salary : ''
  base.order_by = base.order_by || 'publication_time'
  base.period = base.period ?? 7
  base.delay_min = base.delay_min ?? 2
  base.delay_max = base.delay_max ?? 6
  base.daily_limit = base.daily_limit ?? 200
  return base
}

function areaLabelFromId(areaId) {
  if (!areaId) return ''
  const hit = TOP_AREAS.find((t) => String(t.id) === String(areaId))
  return hit ? hit.name : ''
}

function buildSearchPayload(f) {
  const salaryNum =
    f.salary === '' || f.salary === null || f.salary === undefined ? null : Number(f.salary)
  return {
    search_text: f.search_text || null,
    search_fields: Array.isArray(f.search_fields) ? f.search_fields : [],
    area: f.area || null,
    experience: f.experience || null,
    employment: f.employment?.length ? f.employment : [],
    schedule: f.schedule?.length ? f.schedule : [],
    period: f.period,
    salary: Number.isFinite(salaryNum) ? salaryNum : null,
    only_with_salary: !!f.only_with_salary,
    order_by: f.order_by || null,
    delay_min: f.delay_min,
    delay_max: f.delay_max,
    daily_limit: f.daily_limit,
  }
}

export default function Search() {
  const [form, setForm] = useState(defaultForm)
  const [saving, setSaving] = useState(false)
  const [syncHint, setSyncHint] = useState('')
  const [areaQuery, setAreaQuery] = useState('')
  const [areaPicks, setAreaPicks] = useState([])
  const [areaOpen, setAreaOpen] = useState(false)
  /** Уведомление об сохранении (toast в углу экрана) */
  const [saveToast, setSaveToast] = useState(null)

  const formRef = useRef(form)
  const inhibitAutosave = useRef(1)
  const autosaveTimerRef = useRef(null)
  const lastSavedSearchJsonRef = useRef('')

  useEffect(() => {
    formRef.current = form
  }, [form])

  async function load() {
    const { data } = await api.get('/settings')
    const s = data.search || {}
    const normalized = normalizeLoadedSearch(s)
    inhibitAutosave.current += 1
    lastSavedSearchJsonRef.current = JSON.stringify(buildSearchPayload(normalized))
    const label = areaLabelFromId(normalized.area)
    setAreaQuery(label || (normalized.area ? `Регион id ${normalized.area}` : ''))
    setForm(normalized)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const q = areaQuery.trim()
    if (!q) {
      setAreaPicks([])
      return
    }
    const ql = q.toLowerCase()
    const fromTop = TOP_AREAS.filter(
      (t) => t.name.toLowerCase().includes(ql) || String(t.id).includes(q),
    ).map((t) => ({ id: t.id, text: t.name }))
    const picks = [...fromTop]
    if (/^\d+$/.test(q) && !picks.some((p) => String(p.id) === q)) {
      picks.push({ id: q, text: `Регион id ${q} (вручную)` })
    }
    setAreaPicks(picks)
  }, [areaQuery])

  useEffect(() => {
    if (inhibitAutosave.current > 0) {
      inhibitAutosave.current -= 1
      return
    }
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null
      setSyncHint('')
      try {
        const payload = buildSearchPayload(formRef.current)
        const json = JSON.stringify(payload)
        if (json === lastSavedSearchJsonRef.current) return
        await api.put('/settings', { search: payload })
        lastSavedSearchJsonRef.current = json
        setSyncHint('Сохранено автоматически')
      } catch {
        setSyncHint('Не удалось сохранить — проверьте сеть и вход')
        setSaveToast({ ok: false, msg: 'Не удалось сохранить параметры. Проверьте сеть или войдите снова.' })
      }
    }, 2800)
    return () => clearTimeout(autosaveTimerRef.current)
  }, [form])

  useEffect(() => {
    if (!syncHint || !syncHint.startsWith('Сохранено')) return
    const t = setTimeout(() => setSyncHint(''), 2800)
    return () => clearTimeout(t)
  }, [syncHint])

  useEffect(() => {
    if (!saveToast) return
    const t = setTimeout(() => setSaveToast(null), 4000)
    return () => clearTimeout(t)
  }, [saveToast])

  function toggleInList(field, code) {
    setForm((p) => {
      const cur = p[field] || []
      const has = cur.includes(code)
      const next = has ? cur.filter((c) => c !== code) : [...cur, code]
      return { ...p, [field]: next }
    })
  }

  function pickArea(item) {
    setForm((p) => ({ ...p, area: String(item.id) }))
    setAreaQuery(item.text || '')
    setAreaOpen(false)
    setAreaPicks([])
  }

  function pickTopArea(a) {
    setForm((p) => ({ ...p, area: a.id }))
    setAreaQuery(a.name)
    setAreaOpen(false)
    setAreaPicks([])
  }

  function clearArea() {
    setForm((p) => ({ ...p, area: '' }))
    setAreaQuery('')
    setAreaPicks([])
  }

  async function save() {
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
    inhibitAutosave.current += 1
    setSaving(true)
    setSyncHint('')
    try {
      const payload = buildSearchPayload(form)
      await api.put('/settings', { search: payload })
      lastSavedSearchJsonRef.current = JSON.stringify(payload)
      setSyncHint('Сохранено')
      setSaveToast({ ok: true, msg: 'Параметры поиска успешно сохранены.' })
    } catch {
      setSyncHint('Ошибка сохранения')
      setSaveToast({ ok: false, msg: 'Не удалось сохранить: проверьте сеть или войдите снова.' })
    } finally {
      setSaving(false)
    }
  }

  const checkClass =
    'rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm cursor-pointer ' +
    'hover:border-indigo-500/40 flex items-center gap-2 select-none'

  return (
    <div className="space-y-6 relative">
      {saveToast ? (
        <div
          role="status"
          aria-live="polite"
          className={
            'fixed z-[100] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg shadow-black/40 ' +
            (saveToast.ok
              ? 'border-emerald-500/50 bg-emerald-950/95 text-emerald-100'
              : 'border-red-500/45 bg-red-950/95 text-red-100')
          }
        >
          {saveToast.ok ? '✓ ' : ''}
          {saveToast.msg}
        </div>
      ) : null}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Поиск вакансий
          <Hint title="Сохраняются в аккаунте для расширения (лимиты, паузы) и как шпаргалка фильтров при ручном поиске на сайтах вакансий." />
        </h1>
        <p className="text-slate-400 mt-1" title="Данные подтягиваются после входа и сохраняются в базе.">
          Фильтры и лимиты для расширения и ваших же заметок по поиску. Изменения сохраняются сами через ~1,5 с (можно нажать «Сохранить» сразу).
        </p>
        {syncHint ? (
          <p
            className={
              syncHint.includes('Ошибк') || syncHint.includes('Не удалось')
                ? 'text-amber-400 text-sm mt-1'
                : 'text-emerald-400/90 text-sm mt-1'
            }
          >
            {syncHint}
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 space-y-6 max-w-3xl">
        <div className="grid grid-cols-1 gap-3">
          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Ключевые слова</span>
            <input
              className={field}
              placeholder="Например: Python разработчик"
              title="Текстовый запрос (по аналогии с поиском на сайтах вакансий)."
              value={form.search_text || ''}
              onChange={(e) => setForm((p) => ({ ...p, search_text: e.target.value }))}
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm text-slate-400 mb-1 flex items-center gap-2">
              Где искать
              <Hint title="Коды полей поиска (название / описание / компания). Если ничего не отмечено — условно «везде», как на многих сайтах вакансий." />
            </legend>
            <div className="flex flex-wrap gap-2">
              {SEARCH_FIELD_OPTIONS.map((o) => (
                <label
                  key={o.code}
                  className={`${checkClass} ${form.search_fields?.includes(o.code) ? 'border-indigo-500/50 ring-1 ring-indigo-500/25' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={form.search_fields?.includes(o.code)}
                    onChange={() => toggleInList('search_fields', o.code)}
                    className="accent-indigo-500"
                  />
                  {o.label}
                </label>
              ))}
            </div>
            {form.search_fields?.length === 0 && (
              <p className="text-xs text-amber-500/90">Не выбрано ни одного поля — поиск без ограничения по полям (везде).</p>
            )}
          </fieldset>

          <div className="space-y-1 relative">
            <span className="text-sm text-slate-400 flex items-center gap-2">
              Регион
              <Hint title="Подсказки из встроенного списка городов или введите числовой id региона — как на сайте вакансий, которым пользуетесь." />
            </span>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  className={field}
                  placeholder="Город или числовой id региона…"
                  title="Подсказки по популярным городам или свой id"
                  value={areaQuery}
                  onChange={(e) => {
                    setAreaQuery(e.target.value)
                    setAreaOpen(true)
                  }}
                  onFocus={() => setAreaOpen(true)}
                  autoComplete="off"
                />
                {areaOpen && areaPicks.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl">
                    {areaPicks.map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-slate-800"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickArea(it)}
                        >
                          <span className="font-medium">{it.text}</span>
                          {it.parent?.text && (
                            <span className="text-slate-500 text-xs block">{it.parent.text}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {form.area && (
                <button type="button" className={`shrink-0 ${btnNeutral} text-slate-300`} onClick={clearArea}>
                  Сброс
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Выбран id: <span className="text-slate-400">{form.area || '—'}</span>
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {TOP_AREAS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`text-xs px-2 py-1 rounded-lg border border-slate-700 hover:border-indigo-500/50 ${String(form.area) === a.id ? 'bg-indigo-600/25 border-indigo-500/50' : ''}`}
                  onClick={() => pickTopArea(a)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-400 mb-2">Опыт работы</legend>
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE_OPTIONS.map((o) => (
              <label
                key={o.code || 'any'}
                className={`inline-flex items-center gap-2 ${checkClass} ${form.experience === o.code ? 'border-indigo-500/50 ring-1 ring-indigo-500/25' : ''}`}
              >
                <input
                  type="radio"
                  name="experience"
                  checked={form.experience === o.code}
                  onChange={() => setForm((p) => ({ ...p, experience: o.code }))}
                  className="accent-indigo-500"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-400 mb-2">Тип занятости</legend>
          <div className="flex flex-wrap gap-2">
            {EMPLOYMENT_OPTIONS.map((o) => (
              <label key={o.code} className={`${checkClass} ${form.employment?.includes(o.code) ? 'border-indigo-500/50 ring-1 ring-indigo-500/25' : ''}`}>
                <input
                  type="checkbox"
                  checked={form.employment?.includes(o.code)}
                  onChange={() => toggleInList('employment', o.code)}
                  className="accent-indigo-500"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-400 mb-2">График работы</legend>
          <div className="flex flex-wrap gap-2">
            {SCHEDULE_OPTIONS.map((o) => (
              <label key={o.code} className={`${checkClass} ${form.schedule?.includes(o.code) ? 'border-indigo-500/50 ring-1 ring-indigo-500/25' : ''}`}>
                <input
                  type="checkbox"
                  checked={form.schedule?.includes(o.code)}
                  onChange={() => toggleInList('schedule', o.code)}
                  className="accent-indigo-500"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Период публикации</span>
            <select
              className={field}
              title="За какой срок показывать свежие вакансии (для ориентира при ручном поиске)"
              value={form.period}
              onChange={(e) => setForm((p) => ({ ...p, period: Number(e.target.value) }))}
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-slate-400">Сортировка</span>
            <select
              className={field}
              title="Параметр order_by"
              value={form.order_by}
              onChange={(e) => setForm((p) => ({ ...p, order_by: e.target.value }))}
            >
              {ORDER_BY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="block space-y-1 flex-1">
            <span className="text-sm text-slate-400">Зарплата от</span>
            <input
              className={field}
              placeholder="Не задано"
              type="number"
              min={0}
              value={form.salary === '' || form.salary == null ? '' : form.salary}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  salary: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
            />
          </label>
          <label className={`inline-flex items-center gap-2 ${checkClass} mb-0 sm:mb-1 shrink-0 h-[42px]`}>
            <input
              type="checkbox"
              checked={!!form.only_with_salary}
              onChange={(e) => setForm((p) => ({ ...p, only_with_salary: e.target.checked }))}
              className="accent-indigo-500"
            />
            Только с зарплатой
            <Hint title="Учитывать только вакансии с указанной зарплатой (для единообразия с фильтрами на сайтах)." />
          </label>
        </div>

        <div className="border-t border-slate-800 pt-4 space-y-3">
          <p className="text-sm text-slate-500">Настройки отклика</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-sm text-slate-400">Задержка мин, сек</span>
              <input
                className={field}
                type="number"
                min={1}
                value={form.delay_min}
                onChange={(e) => setForm((p) => ({ ...p, delay_min: Number(e.target.value) }))}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-slate-400">Задержка макс, сек</span>
              <input
                className={field}
                type="number"
                min={1}
                value={form.delay_max}
                onChange={(e) => setForm((p) => ({ ...p, delay_max: Number(e.target.value) }))}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-slate-400">Лимит откликов в день</span>
              <input
                className={field}
                type="number"
                min={1}
                max={200}
                value={form.daily_limit}
                onChange={(e) => setForm((p) => ({ ...p, daily_limit: Number(e.target.value) }))}
              />
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={save}
          className={`bg-indigo-600 text-white ${btnPrimary}`}
        >
          {saving ? '…' : 'Сохранить параметры поиска'}
        </button>
      </div>
    </div>
  )
}
