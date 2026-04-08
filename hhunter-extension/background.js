importScripts('utils/api.js')

const STATE_KEY = 'hhunter_state'
const TOKEN_KEY = 'hhunter_token'
const API_BASE_KEY = 'hhunter_api_base'
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

/** Не блокировать onMessage: опрос popup может отсутствовать */
function broadcastState(state) {
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: 'state', state })
    } catch (_) {
      /* нет слушателя — нормально */
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

function isHhVacancyUrl(url) {
  return /https?:\/\/([^/]*\.)?hh\.ru\/vacancy\/\d+/i.test(String(url || ''))
}

function isHhHost(url) {
  try {
    const u = new URL(String(url || 'about:blank'))
    return u.hostname === 'hh.ru' || u.hostname.endsWith('.hh.ru')
  } catch {
    return false
  }
}

async function runOnceOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  const url = tab.url || ''
  if (!isHhHost(url)) {
    await setState({
      last: {
        level: 'WARNING',
        message: 'Сделайте активной вкладку с hh.ru (страница вакансии), затем снова «Запустить».',
      },
    })
    return
  }
  if (!isHhVacancyUrl(url)) {
    await setState({
      last: {
        level: 'WARNING',
        message: 'Откройте одну вакансию (адрес …/vacancy/число), не список поиска.',
      },
    })
    return
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'hhunter_run_once' })
  } catch {
    await setState({
      last: {
        level: 'WARNING',
        message: 'Нажмите F5 на странице hh.ru (после установки расширения), затем «Запустить».',
      },
    })
  }
}

async function mainLoop() {
  while (true) {
    const st = await getState()
    if (!st.running) return
    try {
      await runOnceOnActiveTab()
    } catch (e) {
      await setState({ last: { level: 'ERROR', message: String(e.message || e) } })
    }
    const { settings } = await loadSettings().catch(() => ({ settings: { delay_min: 3, delay_max: 6 } }))
    const delay = Math.round(randBetween(settings.delay_min || 3, settings.delay_max || 6) * 1000)
    await sleep(delay)
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

      if (msg.type === 'get_state') {
        const st = await getState()
        const forceFresh = !!msg.refresh_settings
        try {
          const cfg = await loadSettings(forceFresh)
          return reply({ ok: true, state: st, ext: cfg?.settings || null, api_error: null })
        } catch (e) {
          const api_error =
            e.status === 401
              ? '401: неверный токен. Уберите «Bearer » из поля или нажмите «Токен с сайта».'
              : String(e.message || e)
          return reply({ ok: true, state: st, ext: null, api_error })
        }
      }

      if (msg.type === 'report') {
        const st = await getState()
        const stats = { ...(st.stats || { sent: 0, skipped: 0, error: 0 }) }
        if (msg.kind && stats[msg.kind] != null) stats[msg.kind] += 1
        const next = { ...st, stats, last: msg.last || st.last }
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
