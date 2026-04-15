import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Hint } from '../components/Hint'
import { btnNeutral, btnPrimary, field } from '../ui/hover'

export default function Settings() {
  const [form, setForm] = useState({
    resume_text: '',
    groq_model: 'qwen/qwen3-32b',
    cover_letter_mode: 'ai',
    cover_letter_text: '',
  })
  const [groqKeyInput, setGroqKeyInput] = useState('')
  const [groqConfigured, setGroqConfigured] = useState(false)
  const [health, setHealth] = useState(null)
  const [testRes, setTestRes] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [syncHint, setSyncHint] = useState('')
  const [resumeUploading, setResumeUploading] = useState(false)

  const formRef = useRef(form)
  const resumeFileRef = useRef(null)
  const inhibitAutosave = useRef(1)
  const autosaveTimerRef = useRef(null)
  const lastSavedSettingsJsonRef = useRef('')

  useEffect(() => {
    formRef.current = form
  }, [form])

  async function load() {
    const [{ data }, { data: h }] = await Promise.all([
      api.get('/settings'),
      api.get('/settings/health').catch(() => ({ data: null })),
    ])
    inhibitAutosave.current += 1
    const next = {
      resume_text: data.resume_text || '',
      groq_model: data.groq_model || 'qwen/qwen3-32b',
      cover_letter_mode: data.cover_letter_mode || 'ai',
      cover_letter_text: data.cover_letter_text || '',
    }
    setGroqConfigured(!!data.groq_configured)
    setHealth(h)
    lastSavedSettingsJsonRef.current = JSON.stringify(next)
    setForm(next)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (inhibitAutosave.current > 0) {
      inhibitAutosave.current -= 1
      return
    }
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(async () => {
      autosaveTimerRef.current = null
      setErr('')
      setSyncHint('')
      try {
        const body = { ...formRef.current }
        const json = JSON.stringify(body)
        if (json === lastSavedSettingsJsonRef.current) return
        await api.put('/settings', body)
        lastSavedSettingsJsonRef.current = json
        setSyncHint('Настройки сохранены автоматически')
      } catch (e2) {
        setSyncHint('')
        setErr(e2?.response?.data?.detail || 'Не удалось сохранить')
      }
    }, 2800)
    return () => clearTimeout(autosaveTimerRef.current)
  }, [form])

  useEffect(() => {
    if (!syncHint) return
    const t = setTimeout(() => setSyncHint(''), 2800)
    return () => clearTimeout(t)
  }, [syncHint])

  async function save() {
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
    inhibitAutosave.current += 1
    setErr('')
    setSyncHint('')
    setSaving(true)
    try {
      await api.put('/settings', form)
      lastSavedSettingsJsonRef.current = JSON.stringify(form)
      setSyncHint('Сохранено')
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function testKeys() {
    setTestRes(null)
    const { data } = await api.post('/settings/test-keys')
    setTestRes(data)
  }

  async function testGroqKey() {
    setErr('')
    setTestRes(null)
    try {
      const { data } = await api.post('/extension/test-provider', {
        groq_api_key: groqKeyInput,
        groq_model: form.groq_model,
      })
      setTestRes(data)
    } catch (e2) {
      const d = e2.response?.data?.detail
      setErr(typeof d === 'string' ? d : e2.message || 'Не удалось проверить ключ')
    }
  }

  async function saveGroqKey() {
    setErr('')
    setSyncHint('')
    setSaving(true)
    try {
      await api.put('/settings', { groq_api_key: groqKeyInput, groq_model: form.groq_model })
      setGroqKeyInput('')
      setGroqConfigured(true)
      setSyncHint('Ключ Groq сохранён')
    } catch (e2) {
      const d = e2.response?.data?.detail
      setErr(typeof d === 'string' ? d : e2.message || 'Не удалось сохранить ключ')
    } finally {
      setSaving(false)
    }
  }

  async function uploadResumePdf(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    const okName = file.name?.toLowerCase().endsWith('.pdf')
    const okType = file.type === 'application/pdf' || file.type === 'application/octet-stream'
    if (!okName && !okType) {
      setErr('Нужен файл PDF (например экспорт «Печать → Сохранить как PDF»).')
      return
    }
    setResumeUploading(true)
    setErr('')
    setSyncHint('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await api.post('/settings/resume-upload', fd)
      inhibitAutosave.current += 1
      setForm((p) => ({ ...p, resume_text: data.resume_text ?? '' }))
      setSyncHint(`Текст из PDF подставлен в поле ниже (${data.length?.toLocaleString?.() ?? '?'} симв.)`)
    } catch (e2) {
      const d = e2.response?.data?.detail
      setErr(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg || x).join('; ') : 'Не удалось загрузить PDF')
    } finally {
      setResumeUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Настройки
          <Hint title="Ключ Groq и резюме для генерации писем через бэкенд (расширение и сервер)." />
        </h1>
        <p className="text-slate-400 mt-1">
          Поля сохраняются автоматически через ~3 с после изменения (если данные реально поменялись); поиск и лимиты — вкладка «Поиск».
        </p>
        {health && health.groq_fernet_configured === false ? (
          <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm">
            На сервере не задан <code className="text-amber-200">GROQ_KEY_FERNET_SECRET</code> — сохранить/расшифровать ключ Groq не получится.
            Добавьте переменную в <code className="text-amber-200">backend/.env</code> и перезапустите API.
          </div>
        ) : null}
        {syncHint ? <p className="text-emerald-400/90 text-sm mt-1">{syncHint}</p> : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 space-y-3 transition-shadow hover:shadow-md hover:shadow-black/20">
          <div className="text-sm text-slate-300 flex items-center gap-1 flex-wrap">
            AI‑провайдер: Groq
            <Hint title="Groq (OpenAI‑совместимый) — модель выбирается здесь. Ключ сохраняется в БД в зашифрованном виде (Fernet)." />
          </div>
          <div className="text-xs text-slate-500">
            Статус: {groqConfigured ? <span className="text-emerald-400">ключ настроен</span> : <span className="text-amber-400">ключ не задан</span>}
          </div>
          <input
            className={field}
            placeholder="Groq API key (gsk_…)"
            title="Ключ из console.groq.com (вводится только для сохранения/проверки; с сервера не читается обратно)."
            type="password"
            autoComplete="off"
            value={groqKeyInput}
            onChange={(e) => setGroqKeyInput(e.target.value)}
          />
          <select
            className={field}
            title="Модель по умолчанию для генерации письма"
            value={form.groq_model}
            onChange={(e) => setForm((p) => ({ ...p, groq_model: e.target.value }))}
          >
            <option value="qwen/qwen3-32b">⭐ Qwen3 32B — самый “человечный” русский (хватает почти всем)</option>
            <option value="llama-3.3-70b-versatile">Llama 3.3 70B — если Qwen временно недоступен / хотите другой стиль</option>
            <option value="llama-4-scout-instruct">Llama 4 Scout — если нужен более «сухой» деловой тон</option>
            <option value="llama-3.1-8b-instant">Llama 3.1 8B — когда важнее скорость/объём, чем качество письма</option>
          </select>

          <div className="text-sm text-slate-300 flex items-center gap-1 flex-wrap pt-2">
            Письмо для отклика
            <Hint title="Можно использовать генерацию (AI) или своё письмо/шаблон. Если выбрать «своё», расширение будет брать текст отсюда и не будет требовать ключ/резюме для генерации." />
          </div>
          <select
            className={field}
            title="Источник письма для рассылки/откликов"
            value={form.cover_letter_mode}
            onChange={(e) => setForm((p) => ({ ...p, cover_letter_mode: e.target.value }))}
          >
            <option value="ai">Генерировать (AI)</option>
            <option value="custom">Использовать своё письмо</option>
          </select>
          <textarea
            className={`${field} min-h-40 resize-y ${form.cover_letter_mode === 'custom' ? '' : 'opacity-60'}`}
            placeholder="Текст вашего письма. Можно использовать плейсхолдеры: {vacancy_title}, {company_name}, {salary_info}, {key_skills}, {vacancy_requirements}"
            title="Если выбран режим «своё письмо», текст отсюда будет подставляться в отклик. Поддерживаются простые плейсхолдеры в фигурных скобках."
            disabled={form.cover_letter_mode !== 'custom'}
            value={form.cover_letter_text}
            onChange={(e) => setForm((p) => ({ ...p, cover_letter_text: e.target.value }))}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={saveGroqKey}
              title="Сохранить ключ Groq и модель."
              className={`bg-indigo-600 text-white ${btnPrimary} ${saving ? 'opacity-60' : ''}`}
            >
              {saving ? '…' : 'Сохранить ключ'}
            </button>
            <button
              type="button"
              onClick={testGroqKey}
              title="Проверить введённый ключ (без сохранения)."
              className={`bg-slate-800 text-white ${btnNeutral}`}
            >
              Проверить ключ
            </button>
            <button
              type="button"
              onClick={testKeys}
              title="Проверить сохранённый на сервере ключ/модель (тестовая генерация)."
              className={`bg-slate-800 text-white ${btnNeutral}`}
            >
              Тест сохранённых настроек
            </button>
          </div>
          {err ? <div className="text-sm text-red-400">{err}</div> : null}
          {testRes ? (
            <pre
              className="text-xs bg-slate-950 border border-slate-800 rounded-xl p-3 overflow-auto"
              title="Ответ сервера после проверки провайдера."
            >
              {JSON.stringify(testRes, null, 2)}
            </pre>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 space-y-3 transition-shadow hover:shadow-md hover:shadow-black/20">
          <div className="text-sm text-slate-300 flex items-center gap-1 flex-wrap">
            Резюме
            <Hint title="Текст или PDF — для промпта к Groq при генерации сопроводительного письма." />
          </div>
          <input
            ref={resumeFileRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={uploadResumePdf}
          />
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              disabled={resumeUploading}
              onClick={() => resumeFileRef.current?.click()}
              title="PDF с компьютера: текст извлекается и подставляется в поле ниже."
              className={`px-3 py-2 rounded-xl bg-slate-800 text-white text-sm ${btnNeutral} disabled:opacity-50`}
            >
              {resumeUploading ? 'Читаем PDF…' : 'Загрузить PDF резюме'}
            </button>
            <span className="text-xs text-slate-500">до 6 МБ · текст появится в поле, можно править вручную</span>
          </div>
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/40 px-3 py-2 text-xs text-slate-400 space-y-2 leading-relaxed">
            <p className="text-slate-300 font-medium">Что лучше указать в тексте (для качественного письма)</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <span className="text-slate-300">Цель:</span> желаемая роль и уровень (например middle Python), город/формат если важно.
              </li>
              <li>
                <span className="text-slate-300">Опыт:</span> компании или проекты, должности, примерные сроки (месяцы/годы), что делали по
                сути — не общие слова, а задачи и результат.
              </li>
              <li>
                <span className="text-slate-300">Стек:</span> языки, фреймворки, БД, инфраструктура (Docker, CI, Kafka и т.д.) — как в
                вакансиях, которым откликаетесь.
              </li>
              <li>
                <span className="text-slate-300">Сильные стороны:</span> 1–3 конкретных кейса (масштаб, метрика, «с нуля», оптимизация).
              </li>
              <li>
                <span className="text-slate-300">Образование и языки</span> — если релевантно для работодателя.
              </li>
            </ul>
          </div>
          <textarea
            className={`${field} min-h-64 resize-y`}
            placeholder="Вставьте текст резюме или загрузите PDF выше."
            title="Уходит в промпт к Groq; не публикуется автоматически на сайтах вакансий."
            value={form.resume_text}
            onChange={(e) => setForm((p) => ({ ...p, resume_text: e.target.value }))}
          />
        </div>
      </div>
    </div>
  )
}
