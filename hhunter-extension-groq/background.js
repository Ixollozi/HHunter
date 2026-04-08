importScripts('utils/api.js')

const STATE_KEY = 'hhunter_state'
const TOKEN_KEY = 'hhunter_token'
const API_BASE_KEY = 'hhunter_api_base'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randBetween(a, b) {
  return a + Math.random() * (b - a)
}

async function getState() {
  const st = await chrome.storage.local.get(STATE_KEY)
  return st[STATE_KEY] || { running: false, last: null, stats: { sent: 0, skipped: 0, error: 0 } }
}

async function setState(patch) {
  const cur = await getState()
  const next = { ...cur, ...patch }
  await chrome.storage.local.set({ [STATE_KEY]: next })
  chrome.runtime.sendMessage({ type: 'state', state: next })
  return next
}

async function getToken() {
  const st = await chrome.storage.local.get(TOKEN_KEY)
  return st[TOKEN_KEY] || ''
}

async function getApiBase() {
  const st = await chrome.storage.local.get(API_BASE_KEY)
  return st[API_BASE_KEY] || DEFAULT_API_BASE
}

async function loadSettings() {
  const apiBase = await getApiBase()
  const token = await getToken()
  const s = await apiFetch(apiBase, token, '/extension/settings', { method: 'GET' })
  return { apiBase, token, settings: s }
}

let loopPromise = null

async function runOnceOnActiveTab() {
  const [{ id: tabId }] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tabId) return
  await chrome.tabs.sendMessage(tabId, { type: 'hhunter_run_once' })
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
  ;(async () => {
    if (msg.type === 'set_running') {
      const next = await setState({ running: !!msg.running })
      if (next.running && !loopPromise) {
        loopPromise = mainLoop().finally(() => {
          loopPromise = null
        })
      }
      return sendResponse({ ok: true })
    }
    if (msg.type === 'set_token') {
      await chrome.storage.local.set({ [TOKEN_KEY]: String(msg.token || '') })
      return sendResponse({ ok: true })
    }
    if (msg.type === 'set_api_base') {
      await chrome.storage.local.set({ [API_BASE_KEY]: String(msg.apiBase || DEFAULT_API_BASE) })
      return sendResponse({ ok: true })
    }
    if (msg.type === 'get_state') {
      const st = await getState()
      const cfg = await loadSettings().catch(() => null)
      return sendResponse({ ok: true, state: st, ext: cfg?.settings || null })
    }
    if (msg.type === 'report') {
      const st = await getState()
      const stats = { ...(st.stats || { sent: 0, skipped: 0, error: 0 }) }
      if (msg.kind && stats[msg.kind] != null) stats[msg.kind] += 1
      await setState({ stats, last: msg.last || st.last })
      return sendResponse({ ok: true })
    }
    sendResponse({ ok: false, error: 'unknown message' })
  })()
  return true
})

