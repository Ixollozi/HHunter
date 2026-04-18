importScripts('utils/api.js', 'utils/searchUrl.js')

/** Для chrome.scripting.executeScript: тело копируется в страницу, без замыканий. */
async function serpCollectAsync() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let prev = 0
  let stable = 0
  while (stable < 3) {
    window.scrollTo(0, document.body.scrollHeight)
    await sleep(900)
    const n = document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]').length
    if (n === prev) stable += 1
    else {
      stable = 0
      prev = n
    }
  }
  const items = []
  const seen = new Set()

  function pushFromHref(href, meta) {
    const m = String(href || '').match(/\/vacancy\/(\d+)/)
    if (m && m[1] && !seen.has(m[1])) {
      seen.add(m[1])
      items.push({
        id: m[1],
        title: meta && meta.title ? String(meta.title).slice(0, 480) : '',
        company: meta && meta.company ? String(meta.company).slice(0, 480) : '',
      })
      return true
    }
    return false
  }

  // Primary selectors (hh.ru / hh.uz may differ)
  const cardSelectors = [
    '[data-qa="vacancy-serp__vacancy"]',
    '[data-qa="serp-item"]',
    '[data-qa*="serp-item"]',
  ]
  let cards = []
  for (const sel of cardSelectors) {
    try {
      const found = Array.from(document.querySelectorAll(sel))
      if (found.length) {
        cards = found
        break
      }
    } catch {
      /* */
    }
  }

  if (cards.length) {
    cards.forEach((card) => {
      const a =
        card.querySelector('a[data-qa="serp-item__title"]') ||
        card.querySelector('a[data-qa*="serp-item__title"]') ||
        card.querySelector('a[href*="/vacancy/"]')
      if (!a || !a.href) return
      // Title
      const titleText = (a.textContent || '').trim()
      // Company: try common selectors on hh.ru SERP
      let companyText = ''
      try {
        const c1 =
          card.querySelector('[data-qa="vacancy-serp__vacancy-employer"]') ||
          card.querySelector('[data-qa="serp-item__meta-info-company"]') ||
          card.querySelector('[data-qa="serp-item__company-name"]') ||
          card.querySelector('[data-qa*="company"] a') ||
          card.querySelector('a[href*="/employer/"]')
        companyText = (c1 && c1.textContent ? c1.textContent : '').trim()
      } catch {
        companyText = ''
      }
      pushFromHref(a.href, { title: titleText, company: companyText })
    })
  }

  // Fallback: collect any /vacancy/{id} links from the page (within main content)
  if (items.length < 3) {
    let scope = null
    try {
      scope =
        document.querySelector('[data-qa="vacancy-serp__results"]') ||
        document.querySelector('[data-qa="serp-results"]') ||
        document.querySelector('main') ||
        document.body
    } catch {
      scope = document.body
    }
    try {
      Array.from(scope.querySelectorAll('a[href*="/vacancy/"]')).forEach((a) => {
        if (!a || !a.href) return
        // Fallback: no reliable meta
        pushFromHref(a.href, null)
      })
    } catch {
      /* */
    }
  }

  // Safety: cap to avoid accidental huge runs on malformed pages
  if (items.length > 120) items.length = 120
  const nextEl = document.querySelector('[data-qa="pager-next"]')
  let nextHref = nextEl && nextEl.href ? nextEl.href : null

  // Fallback: some HH SERP layouts don't expose pager-next reliably.
  // HH uses 0-based page index: page=0 (or missing) -> 1st page, page=1 -> 2nd, etc.
  if (!nextHref) {
    try {
      const u = new URL(String(location.href || ''))
      const raw = u.searchParams.get('page')
      const cur = raw == null || raw === '' ? 0 : parseInt(String(raw), 10)
      const curPage = Number.isFinite(cur) && cur >= 0 ? cur : 0
      u.searchParams.set('page', String(curPage + 1))
      nextHref = u.href
    } catch {
      nextHref = null
    }
  }
  return { items, nextHref }
}

const STATE_KEY = 'hhunter_state'
const TOKEN_KEY = 'hhunter_token'
const API_BASE_KEY = 'hhunter_api_base'
const RUN_MODE_KEY = 'hhunter_run_mode'
const HH_ORIGIN_KEY = 'hhunter_hh_origin'
const DEFAULT_HH_ORIGIN = 'https://hh.ru'
const SETTINGS_TTL_MS = 45_000

let settingsCache = {
  at: 0,
  apiBase: '',
  token: '',
  settings: null,
}

function invalidateSettingsCache() {
  settingsCache = { at: 0, apiBase: '', token: '', settings: null }
}

function normalizeToken(raw) {
  let t = String(raw || '').trim()
  if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, '').trim()
  return t
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randBetween(a, b) {
  return a + Math.random() * (b - a)
}

/**
 * Пока достигнут почасовой лимит на сервере — ждём (опрос раз в pollMs), не останавливая цикл.
 * @returns {'ok'|'stopped'|'daily_limit'}
 */
async function waitUntilHourlySlotAvailable() {
  const pollMs = 30_000
  while (true) {
    const st = await getState()
    if (!st.running) return 'stopped'
    let fresh
    try {
      fresh = await loadSettings(true)
    } catch {
      await sleep(pollMs)
      continue
    }
    const sentToday = parseInt(fresh.settings.sent_today, 10) || 0
    const sentHour = parseInt(fresh.settings.sent_last_hour, 10) || 0
    const dailyLimit = Math.min(parseInt(fresh.settings.daily_limit, 10) || 200, 500)
    const hourlyLimit = Math.min(Math.max(parseInt(fresh.settings.hourly_limit, 10) || 35, 10), 80)
    if (sentToday >= dailyLimit) return 'daily_limit'
    if (sentHour < hourlyLimit) return 'ok'
    await setState({
      last: {
        level: 'INFO',
        message: `Лимит за час (UTC): ${sentHour}/${hourlyLimit}. Ожидание слота — цикл не остановлен, отклики не превысят лимит.`,
      },
    })
    void extActivityLog(
      'INFO',
      `Ожидание часового лимита ${sentHour}/${hourlyLimit} (UTC)`,
      'extension_bg',
      'full_auto_hourly_wait',
    )
    await sleep(pollMs)
  }
}

/** Не засыпать БД одинаковыми шагами при частых перезапусках mainLoop (опрос UI, двойные сообщения). */
const logThrottleAt = new Map()
const LOG_THROTTLE_MS = {
  main_loop_begin: 2200,
  active_tab_start: 2200,
  active_tab_finish: 2200,
  active_tab_wrong_host: 14000,
  active_tab_not_vacancy: 14000,
  active_tab_no_tab: 14000,
  full_auto_hourly_wait: 60_000,
  full_auto_hourly_limit_wait: 45_000,
  full_auto_hourly_limit_wait_inline: 45_000,
}

function logThrottleAllow(step, message) {
  const st = String(step || '')
  const ms = LOG_THROTTLE_MS[st]
  if (ms == null) return true
  const key = `${st}::${String(message).slice(0, 280)}`
  const now = Date.now()
  const prev = logThrottleAt.get(key)
  if (prev != null && now - prev < ms) return false
  logThrottleAt.set(key, now)
  if (logThrottleAt.size > 100) {
    const cutoff = now - 120000
    for (const [k, t] of logThrottleAt.entries()) {
      if (t < cutoff) logThrottleAt.delete(k)
    }
  }
  return true
}

/** Журнал на сервер (вкладка «Логи» в HHunter). Ошибки глотаем — не блокируем цикл. */
async function extActivityLog(level, message, source, step) {
  try {
    if (!logThrottleAllow(step, message)) return
    const apiBase = await getApiBase()
    const token = await getToken()
    if (!token) return
    await apiFetch(apiBase, token, '/extension/log', {
      method: 'POST',
      body: JSON.stringify({
        level: String(level || 'INFO').toUpperCase(),
        message: String(message || '').slice(0, 3800),
        source: source || 'extension_bg',
        step: step || null,
      }),
    })
  } catch (_) {
    /* */
  }
}

function tabsSendOnce(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (r) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
        else resolve(r)
      })
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Доставка в content: при «нет получателя» — программная инъекция content.js и повтор.
 * Таймаут 180 с: генерация письма и модалки HH могут занимать >2 мин.
 */
async function tabsSendMessageWithTimeout(tabId, message, timeoutMs) {
  const ms = timeoutMs || 180000
  async function sendWithOptionalInject() {
    try {
      return await tabsSendOnce(tabId, message)
    } catch (e) {
      const errText = String((e && e.message) || e)
      if (
        !/Receiving end does not exist|Could not establish connection|The message port closed before a response was received/i.test(
          errText,
        )
      ) {
        throw e
      }
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      } catch (injErr) {
        throw new Error(
          `${errText} (повторная инъекция: ${String((injErr && injErr.message) || injErr)})`,
        )
      }
      await sleep(300)
      return await tabsSendOnce(tabId, message)
    }
  }
  try {
    return await Promise.race([
      sendWithOptionalInject(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Нет ответа от страницы за ${Math.round(ms / 1000)} с (вкладка перезагрузилась или content script не успел). Обновите страницу HeadHunter (hh.ru / hh.uz и т.д.).`,
              ),
            ),
          ms,
        ),
      ),
    ])
  } catch (e) {
    const errText = String((e && e.message) || e)
    if (
      /message channel closed before a response was received|asynchronous response by returning true|The message port closed/i.test(
        errText,
      )
    ) {
      // Ждём — content мог продолжить работу после разрыва канала
      await sleep(8000)
      const recovered = await tryRecoverApplyAfterContentNav(tabId)
      if (recovered) return recovered
    }
    throw e
  }
}

/** Content умер при переходе (чат HH в той же вкладке); учёт отклика по заранее сохранённому payload. */
async function tryRecoverApplyAfterContentNav(tabId) {
  if (tabId == null) return null
  const key = `hhunter_nav_guard_${tabId}`
  let raw
  try {
    raw = await chrome.storage.session.get(key)
  } catch {
    return null
  }
  const g = raw[key]
  if (!g || !g.savePayload || Date.now() - (g.ts || 0) > 90000) {
    try {
      await chrome.storage.session.remove(key)
    } catch {
      /* */
    }
    return null
  }
  try {
    await chrome.storage.session.remove(key)
  } catch {
    /* */
  }
  try {
    const apiBase = await getApiBase()
    const token = await getToken()
    if (token) {
      await apiFetch(apiBase, token, '/extension/save-application', {
        method: 'POST',
        body: JSON.stringify({ ...g.savePayload, status: 'sent' }),
      })
    }
  } catch {
    /* */
  }
  void extActivityLog(
    'INFO',
    'Вкладка перешла (чат/навигация HH) до ответа content — отклик записан на сервер из service worker',
    'extension_bg',
    'active_tab_nav_recover',
  )
  const semi = !!g.semiAuto
  return { ok: true, submitted: !semi, via_chat: true, navigated_recover: true }
}

function broadcastState(state) {
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: 'state', state })
    } catch (_) {
      /* */
    }
  }, 0)
}

async function getState() {
  const st = await chrome.storage.local.get(STATE_KEY)
  return st[STATE_KEY] || { running: false, last: null, stats: { sent: 0, skipped: 0, error: 0 } }
}

async function setState(patch) {
  const cur = await getState()
  const next = { ...cur, ...patch }
  await chrome.storage.local.set({ [STATE_KEY]: next })
  broadcastState(next)
  return next
}

async function getToken() {
  const st = await chrome.storage.local.get(TOKEN_KEY)
  return normalizeToken(st[TOKEN_KEY] || '')
}

async function getApiBase() {
  const st = await chrome.storage.local.get(API_BASE_KEY)
  const b = st[API_BASE_KEY] || DEFAULT_API_BASE
  return String(b).trim().replace(/\/$/, '') || DEFAULT_API_BASE
}

async function loadSettings(force = false) {
  const apiBase = await getApiBase()
  const token = await getToken()
  const now = Date.now()
  if (
    !force &&
    settingsCache.settings &&
    settingsCache.apiBase === apiBase &&
    settingsCache.token === token &&
    now - settingsCache.at < SETTINGS_TTL_MS
  ) {
    return { apiBase, token, settings: settingsCache.settings }
  }
  const s = await apiFetch(apiBase, token, '/extension/settings', { method: 'GET' })
  settingsCache = { at: now, apiBase, token, settings: s }
  return { apiBase, token, settings: s }
}

let loopPromise = null

function isHhHost(url) {
  try {
    const u = new URL(String(url || 'about:blank'))
    const h = u.hostname.toLowerCase()
    if (h === 'hh.ru' || h.endsWith('.hh.ru')) return true
    if (h === 'hh.uz' || h.endsWith('.hh.uz')) return true
    if (h === 'hh.kz' || h.endsWith('.hh.kz')) return true
    return false
  } catch {
    return false
  }
}

function isHhVacancyUrl(url) {
  return isHhHost(url) && /\/vacancy\/\d+/i.test(String(url || ''))
}

async function getHhWebOrigin() {
  const st = await chrome.storage.local.get(HH_ORIGIN_KEY)
  let raw = String(st[HH_ORIGIN_KEY] || DEFAULT_HH_ORIGIN).trim().replace(/\/$/, '')
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') throw new Error('need https')
    if (!isHhHost(u.href)) raw = DEFAULT_HH_ORIGIN
    else return u.origin
  } catch {
    raw = DEFAULT_HH_ORIGIN
  }
  return new URL(DEFAULT_HH_ORIGIN).origin
}

function waitTabComplete(tabId) {
  return new Promise((resolve) => {
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
        return
      }
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    })
  })
}

async function runOnceOnActiveTab() {
  void extActivityLog('INFO', 'Режим активной вкладки: старт', 'extension_bg', 'active_tab_start')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    void extActivityLog('WARNING', 'Нет активной вкладки', 'extension_bg', 'active_tab_no_tab')
    return
  }
  const url = tab.url || ''
  if (!isHhHost(url)) {
    void extActivityLog('WARNING', `Активная вкладка не HeadHunter: ${url.slice(0, 120)}`, 'extension_bg', 'active_tab_wrong_host')
    await setState({
      last: {
        level: 'WARNING',
        message:
          'Сделайте активной вкладку с сайта HeadHunter (hh.ru, tashkent.hh.uz, …) — страница вакансии, затем «Запустить».',
      },
    })
    return
  }
  if (!isHhVacancyUrl(url)) {
    void extActivityLog('WARNING', 'Нужна страница вакансии /vacancy/{id}, не список поиска', 'extension_bg', 'active_tab_not_vacancy')
    await setState({
      last: {
        level: 'WARNING',
        message: 'Откройте одну вакансию (адрес …/vacancy/число), не список поиска.',
      },
    })
    return
  }
  await waitTabComplete(tab.id)
  await sleep(180)
  void extActivityLog('INFO', `Отправка в сценарий страницы (content script): ${url}`, 'extension_bg', 'active_tab_send')
  try {
    const r = await tabsSendMessageWithTimeout(tab.id, { type: 'hhunter_run_once', autoSubmit: false }, 180000)
    void extActivityLog(
      'INFO',
      `Ответ страницы: ok=${r?.ok}, submitted=${r?.submitted}, err=${r?.error || '—'}${r?.navigated_recover ? ' · восстановлено после перехода' : ''}${r?.chat_new_tab ? ' · чат в новой вкладке' : ''}`,
      'extension_bg',
      'active_tab_done',
    )
  } catch (e) {
    void extActivityLog('ERROR', String(e.message || e), 'extension_bg', 'active_tab_send_failed')
    await setState({
      last: {
        level: 'WARNING',
        message:
          (e.message || String(e)) +
          ' Если текст про «message channel closed» — обновите F5 страницу вакансии и повторите.',
      },
    })
  }
}

async function fullAutoLoop() {
  let apiBase
  let token
  let settings
  try {
    ;({ apiBase, token, settings } = await loadSettings(true))
  } catch (e) {
    void extActivityLog('ERROR', `Настройки API: ${e.message || e}`, 'extension_bg', 'full_auto_settings_fail')
    await setState({
      running: false,
      last: { level: 'ERROR', message: `Настройки: ${e.message || e}` },
    })
    return
  }
  const search = settings.search || {}
  if (!String(search.search_text || '').trim()) {
    void extActivityLog(
      'WARNING',
      'Нет текста поиска (поле search_text) в сохранённых параметрах HHunter',
      'extension_bg',
      'full_auto_no_search_text',
    )
    await setState({
      running: false,
      last: { level: 'WARNING', message: 'Укажите текст поиска в разделе «Поиск» на сайте HHunter.' },
    })
    return
  }
  const dailyLimit = Math.min(parseInt(settings.daily_limit, 10) || 200, 500)
  const hourlyLimit = Math.min(Math.max(parseInt(settings.hourly_limit, 10) || 35, 10), 80)
  const hhOrigin = await getHhWebOrigin()
  let searchUrl = buildSearchUrl(search, hhOrigin)
  void extActivityLog(
    'INFO',
    `Полный цикл: лимит день ${dailyLimit}, час ${hourlyLimit}, сайт ${hhOrigin}, первая выдача ${searchUrl}`,
    'extension_bg',
    'full_auto_begin',
  )

  while (true) {
    const st0 = await getState()
    if (!st0.running) return

    let fresh
    try {
      fresh = await loadSettings(true)
    } catch {
      fresh = { settings }
    }
    const sentToday = parseInt(fresh.settings.sent_today, 10) || 0
    const sentHour = parseInt(fresh.settings.sent_last_hour, 10) || 0
    const hourLim = Math.min(Math.max(parseInt(fresh.settings.hourly_limit, 10) || 35, 10), 80)
    if (sentToday >= dailyLimit) {
      void extActivityLog('INFO', `Стоп: лимит UTC ${sentToday}/${dailyLimit}`, 'extension_bg', 'full_auto_limit')
      await setState({
        running: false,
        last: { level: 'INFO', message: `Дневной лимит (UTC): ${sentToday}/${dailyLimit}` },
      })
      return
    }
    if (sentHour >= hourLim) {
      void extActivityLog(
        'INFO',
        `Лимит за час ${sentHour}/${hourLim} — пауза до освобождения слота`,
        'extension_bg',
        'full_auto_hourly_limit_wait',
      )
      const w = await waitUntilHourlySlotAvailable()
      if (w === 'stopped') return
      if (w === 'daily_limit') {
        void extActivityLog('INFO', `Стоп: дневной лимит UTC при ожидании часа`, 'extension_bg', 'full_auto_limit')
        await setState({
          running: false,
          last: { level: 'INFO', message: `Дневной лимит (UTC) достигнут во время ожидания часового окна.` },
        })
        return
      }
    }

    await setState({ last: { level: 'INFO', message: `Выдача: загрузка…` } })
    void extActivityLog('INFO', `Загрузка выдачи поиска (SERP): ${searchUrl}`, 'extension_bg', 'full_auto_serp_open')
    let tab
    try {
      tab = await chrome.tabs.create({ url: searchUrl, active: false })
    } catch (e) {
      await setState({ last: { level: 'ERROR', message: `Вкладка: ${e.message || e}` } })
      await sleep(3000)
      continue
    }
    await waitTabComplete(tab.id)
    await sleep(1300)

    let collected
    try {
      const inj = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: serpCollectAsync,
      })
      collected = inj[0]?.result
    } catch (e) {
      await chrome.tabs.remove(tab.id).catch(() => {})
      await setState({ last: { level: 'ERROR', message: `Сбор выдачи (SERP): ${e.message || e}` } })
      await sleep(4000)
      continue
    }
    await chrome.tabs.remove(tab.id).catch(() => {})

    const items = collected?.items || []
    const nextHref = collected?.nextHref || null
    void extActivityLog(
      'INFO',
      `Выдача собрана: вакансий ${items.length}, следующая страница: ${nextHref ? 'да' : 'нет'}`,
      'extension_bg',
      'full_auto_serp_collected',
    )

    if (items.length === 0) {
      void extActivityLog('WARNING', 'На выдаче 0 вакансий (селекторы или пустой запрос)', 'extension_bg', 'full_auto_serp_empty')
      await setState({
        running: false,
        last: { level: 'INFO', message: 'Нет вакансий на странице поиска или не совпали селекторы DOM.' },
      })
      return
    }

    for (const it of items) {
      const vid = String(it && it.id ? it.id : '').trim()
      if (!vid) continue
      const st = await getState()
      if (!st.running) return

      try {
        const q = new URLSearchParams()
        q.set('vacancy_id', vid)
        if (it && it.title) q.set('title', String(it.title).slice(0, 512))
        if (it && it.company) q.set('company_name', String(it.company).slice(0, 512))
        const chk = await apiFetch(apiBase, token, `/extension/vacancy-known?${q.toString()}`, { method: 'GET' })
        if (chk && chk.already_applied) {
          void extActivityLog('INFO', `Пропуск ${vid}: уже в базе`, 'extension_bg', 'full_auto_skip_known')
          continue
        }
      } catch {
        /* игнор — продолжим */
      }

      let stFresh
      try {
        stFresh = await loadSettings(true)
      } catch {
        stFresh = fresh
      }
      if ((parseInt(stFresh.settings.sent_today, 10) || 0) >= dailyLimit) {
        await setState({
          running: false,
          last: { level: 'INFO', message: `Лимит (UTC) во время цикла.` },
        })
        return
      }
      const sh = parseInt(stFresh.settings.sent_last_hour, 10) || 0
      const hl = Math.min(Math.max(parseInt(stFresh.settings.hourly_limit, 10) || 35, 10), 80)
      if (sh >= hl) {
        void extActivityLog(
          'INFO',
          `Перед вакансией ${vid}: лимит за час ${sh}/${hl} — пауза`,
          'extension_bg',
          'full_auto_hourly_limit_wait_inline',
        )
        const w = await waitUntilHourlySlotAvailable()
        if (w === 'stopped') return
        if (w === 'daily_limit') {
          await setState({
            running: false,
            last: { level: 'INFO', message: `Дневной лимит (UTC) во время цикла.` },
          })
          return
        }
      }

      await setState({ last: { level: 'INFO', message: `Вакансия ${vid}…` } })
      void extActivityLog('INFO', `Открытие вкладки вакансии ${vid}`, 'extension_bg', 'full_auto_vacancy_open')
      let vacTab
      try {
        vacTab = await chrome.tabs.create({ url: `${hhOrigin}/vacancy/${vid}`, active: false })
      } catch (e) {
        void extActivityLog('ERROR', `Вкладка вакансии: ${e.message || e}`, 'extension_bg', 'full_auto_tab_fail')
        await setState({ last: { level: 'ERROR', message: `Вкладка вакансии: ${e.message || e}` } })
        continue
      }
      await waitTabComplete(vacTab.id)
      await sleep(550)
      try {
        const r = await tabsSendMessageWithTimeout(vacTab.id, { type: 'hhunter_run_once', autoSubmit: true }, 180000)
        void extActivityLog(
          'INFO',
          `Вакансия ${vid}: ok=${r?.ok}, submitted=${r?.submitted}, err=${r?.error || '—'}`,
          'extension_bg',
          'full_auto_vacancy_done',
        )
      } catch (e) {
        if (/message channel closed|asynchronous response/i.test(String(e.message || e))) {
          try {
            // Сначала сохраняем ошибку в applications — счётчик для блэклиста
            await apiFetch(apiBase, token, '/extension/save-application', {
              method: 'POST',
              body: JSON.stringify({
                vacancy_id: vid,
                vacancy_title: `Вакансия ${vid}`,
                vacancy_url: `${hhOrigin}/vacancy/${vid}`,
                status: 'error',
                error_message: 'channel_closed',
              }),
            })
          } catch {
            /* уже в базе — игнор 409 */
          }
          try {
            const blRes = await apiFetch(apiBase, token, '/extension/blacklist-vacancy', {
              method: 'POST',
              body: JSON.stringify({ vacancy_id: vid, reason: 'channel_closed' }),
            })
            if (blRes && blRes.blacklisted) {
              void extActivityLog(
                'WARNING',
                `Вакансия ${vid} в блэклисте после повторных ошибок (код: channel_closed)`,
                'extension_bg',
                'full_auto_blacklist',
              )
            }
          } catch {
            /* */
          }
        }
        void extActivityLog('ERROR', `Вакансия ${vid}: ${e.message || e}`, 'extension_bg', 'full_auto_vacancy_msg_fail')
        await setState({
          last: {
            level: 'WARNING',
            message:
              (e.message || String(e)) +
              ' Частая причина — вкладка закрыла канал до ответа; F5 на странице вакансии и повтор.',
          },
        })
      }
      await sleep(1200)
      await chrome.tabs.remove(vacTab.id).catch(() => {})

      const delaySettings = await loadSettings().catch(() => ({ settings: { delay_min: 2, delay_max: 4 } }))
      let dmin = Number(delaySettings.settings?.delay_min ?? 2)
      let dmax = Number(delaySettings.settings?.delay_max ?? 4)
      if (!Number.isFinite(dmin)) dmin = 2
      if (!Number.isFinite(dmax)) dmax = 4
      dmin = Math.max(1.5, dmin)
      dmax = Math.max(dmin, dmax)
      await sleep(Math.round(randBetween(dmin, dmax) * 1000))
    }

    if (nextHref) {
      void extActivityLog('INFO', 'Переход на следующую страницу выдачи', 'extension_bg', 'full_auto_pager_next')
      searchUrl = nextHref
    } else {
      void extActivityLog('INFO', 'Конец выдачи (нет ссылки «следующая», pager-next)', 'extension_bg', 'full_auto_end')
      await setState({
        running: false,
        last: { level: 'INFO', message: 'Обработана выдача (нет следующей страницы).' },
      })
      return
    }
  }
}

async function mainLoop() {
  const st0 = await getState()
  if (!st0.running) return
  const rm = await chrome.storage.local.get(RUN_MODE_KEY)
  const mode = rm[RUN_MODE_KEY] || 'active_tab'
  void extActivityLog('INFO', `Старт главного цикла, режим: ${mode}`, 'extension_bg', 'main_loop_begin')
  try {
    if (mode === 'full_auto') {
      await fullAutoLoop()
    } else {
      await runOnceOnActiveTab()
    }
  } catch (e) {
    void extActivityLog('ERROR', `Главный цикл: ${e.message || e}`, 'extension_bg', 'main_loop_error')
    await setState({ last: { level: 'ERROR', message: String(e.message || e) }, running: false })
  } finally {
    // Режим «активная вкладка»: один прогон за нажатие «Запустить», без повторов на той же вакансии.
    if (mode !== 'full_auto') {
      await setState({ running: false })
      void extActivityLog('INFO', 'Режим активной вкладки: завершён', 'extension_bg', 'active_tab_finish')
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let replied = false
  function reply(payload) {
    if (replied) return
    replied = true
    try {
      sendResponse(payload)
    } catch (_) {
      /* */
    }
  }

  ;(async () => {
    try {
      if (msg.type === 'hhunter_keepalive') {
        return reply({ ok: true })
      }

      if (msg.type === 'open_chat_tab') {
        const url = String(msg.url || '')
        if (url.startsWith('https://') || url.startsWith('http://')) {
          chrome.tabs.create({ url, active: true }).catch(() => {})
        }
        return reply({ ok: true })
      }

      if (msg.type === 'hhunter_apply_nav_guard') {
        const tid = sender.tab && sender.tab.id
        if (tid != null && msg.savePayload) {
          try {
            await chrome.storage.session.set({
              [`hhunter_nav_guard_${tid}`]: {
                ts: Date.now(),
                savePayload: msg.savePayload,
                semiAuto: !!msg.semiAuto,
              },
            })
          } catch {
            /* */
          }
        }
        return reply({ ok: true })
      }

      if (msg.type === 'hhunter_apply_nav_guard_clear') {
        const tid = sender.tab && sender.tab.id
        if (tid != null) {
          try {
            await chrome.storage.session.remove(`hhunter_nav_guard_${tid}`)
          } catch {
            /* */
          }
        }
        return reply({ ok: true })
      }

      if (msg.type === 'set_run_mode') {
        const v = msg.mode === 'full_auto' ? 'full_auto' : 'active_tab'
        await chrome.storage.local.set({ [RUN_MODE_KEY]: v })
        return reply({ ok: true })
      }

      if (msg.type === 'set_running') {
        const next = await setState({ running: !!msg.running })
        if (next.running && !loopPromise) {
          loopPromise = mainLoop().finally(() => {
            loopPromise = null
          })
        }
        return reply({ ok: true })
      }

      if (msg.type === 'set_token') {
        invalidateSettingsCache()
        await chrome.storage.local.set({ [TOKEN_KEY]: normalizeToken(String(msg.token || '')) })
        return reply({ ok: true })
      }

      if (msg.type === 'set_api_base') {
        invalidateSettingsCache()
        const b =
          String(msg.apiBase || DEFAULT_API_BASE)
            .trim()
            .replace(/\/$/, '') || DEFAULT_API_BASE
        await chrome.storage.local.set({ [API_BASE_KEY]: b })
        return reply({ ok: true })
      }

      if (msg.type === 'set_hh_origin') {
        let o = String(msg.origin || DEFAULT_HH_ORIGIN).trim().replace(/\/$/, '')
        try {
          const u = new URL(o)
          if (u.protocol !== 'https:') throw new Error('https only')
          if (!isHhHost(u.href)) o = DEFAULT_HH_ORIGIN
          else o = u.origin
        } catch {
          o = DEFAULT_HH_ORIGIN
        }
        await chrome.storage.local.set({ [HH_ORIGIN_KEY]: o })
        return reply({ ok: true, hh_origin: o })
      }

      if (msg.type === 'get_state') {
        const st = await getState()
        const forceFresh = !!msg.refresh_settings
        const rm = await chrome.storage.local.get(RUN_MODE_KEY)
        const hhOrigin = await getHhWebOrigin()
        try {
          const cfg = await loadSettings(forceFresh)
          return reply({
            ok: true,
            state: st,
            ext: cfg?.settings || null,
            api_error: null,
            run_mode: rm[RUN_MODE_KEY] || 'active_tab',
            hh_origin: hhOrigin,
          })
        } catch (e) {
          const api_error =
            e.status === 401
              ? '401: неверный токен. Уберите «Bearer » из поля или нажмите «Токен с сайта».'
              : String(e.message || e)
          return reply({
            ok: true,
            state: st,
            ext: null,
            api_error,
            run_mode: rm[RUN_MODE_KEY] || 'active_tab',
            hh_origin: hhOrigin,
          })
        }
      }

      if (msg.type === 'hhunter_api') {
        const path = String(msg.path || '')
        if (!path.startsWith('/extension/')) {
          return reply({ ok: false, handled: true, error: 'invalid path' })
        }
        try {
          const apiBase = await getApiBase()
          const token = await getToken()
          const method = String(msg.method || 'GET').toUpperCase()
          const bodyRaw = msg.body
          const base = String(apiBase || '').replace(/\/$/, '')
          const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
          const headers = {}
          if (token) headers.Authorization = `Bearer ${token}`
          if (bodyRaw != null && method !== 'GET' && method !== 'HEAD') {
            headers['Content-Type'] = 'application/json'
          }
          const res = await fetch(url, {
            method,
            headers,
            body: bodyRaw == null || method === 'GET' || method === 'HEAD' ? undefined : String(bodyRaw),
          })
          const text = await res.text()
          let data = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = text
          }
          return reply({ ok: true, handled: true, status: res.status, statusOk: res.ok, data })
        } catch (e) {
          return reply({ ok: false, handled: true, networkError: String((e && e.message) || e) })
        }
      }

      if (msg.type === 'report') {
        const st = await getState()
        const stats = { ...(st.stats || { sent: 0, skipped: 0, error: 0 }) }
        if (msg.kind && stats[msg.kind] != null) stats[msg.kind] += 1
        const next = { ...st, stats, last: msg.last || st.last }
        if (msg.stop_loop) next.running = false
        await chrome.storage.local.set({ [STATE_KEY]: next })
        broadcastState(next)
        return reply({ ok: true })
      }

      if (msg.type === 'pull_token_from_site') {
        const tabs = await chrome.tabs.query({})
        for (const tab of tabs) {
          const raw = tab.url || ''
          if (!tab.id) continue
          if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(raw)) continue
          try {
            const [{ result }] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => localStorage.getItem('hhunter_token'),
            })
            const tok = normalizeToken(result || '')
            if (tok) {
              invalidateSettingsCache()
              await chrome.storage.local.set({ [TOKEN_KEY]: tok })
              return reply({ ok: true, token: tok })
            }
          } catch {
            continue
          }
        }
        return reply({
          ok: false,
          error: 'Откройте вкладку HHunter (localhost), войдите, и повторите.',
        })
      }

      reply({ ok: false, error: 'unknown message' })
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) })
    }
  })()

  return true
})
