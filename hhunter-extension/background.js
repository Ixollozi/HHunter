/** Service worker: API вызовы и координация с content script. */

const DEFAULT_API = 'http://localhost:8000'
const DEFAULT_FRONTEND = 'http://localhost:5173'

async function getLocal(keys) {
  return chrome.storage.local.get(keys)
}

async function setLocal(obj) {
  return chrome.storage.local.set(obj)
}

async function apiFetch(path, init = {}) {
  const st = await getLocal(['apiBaseUrl', 'authToken'])
  const base = (st.apiBaseUrl || DEFAULT_API).replace(/\/$/, '')
  const token = st.authToken || ''
  const headers = { ...init.headers }
  if (!headers['Content-Type'] && init.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${base}${path}`, { ...init, headers })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = data?.detail || data?.message || text || res.statusText
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

async function loadSettings() {
  return apiFetch('/extension/settings', { method: 'GET' })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  /** @type {string} */
  const t = message?.type

  if (t === 'GET_STATE') {
    getLocal(['isRunning', 'authToken', 'userName', 'apiBaseUrl', 'frontendOrigin']).then(sendResponse)
    return true
  }

  if (t === 'SET_RUNNING') {
    setLocal({ isRunning: !!message.value }).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  if (t === 'SET_CONFIG') {
    const patch = {}
    if (message.apiBaseUrl != null) patch.apiBaseUrl = String(message.apiBaseUrl).trim() || DEFAULT_API
    if (message.frontendOrigin != null) patch.frontendOrigin = String(message.frontendOrigin).trim() || DEFAULT_FRONTEND
    setLocal(patch).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  if (t === 'SAVE_TOKEN') {
    setLocal({
      authToken: message.token || '',
      userName: message.userName || '',
    })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  if (t === 'EXTENSION_SETTINGS') {
    loadSettings()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  if (t === 'GENERATE_LETTER') {
    apiFetch('/extension/generate-letter', {
      method: 'POST',
      body: JSON.stringify(message.payload || {}),
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  if (t === 'SAVE_APPLICATION') {
    apiFetch('/extension/save-application', {
      method: 'POST',
      body: JSON.stringify(message.payload || {}),
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  if (t === 'EXTENSION_LOG') {
    const level = message.level || 'INFO'
    const line = String(message.message || '').slice(0, 4000)
    apiFetch('/extension/log', {
      method: 'POST',
      body: JSON.stringify({ level, message: line }),
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }

  if (t === 'FIND_FRONTEND_TAB') {
    chrome.tabs.query({}, (tabs) => {
      let origin
      try {
        origin = new URL(message.frontendOrigin || DEFAULT_FRONTEND).origin
      } catch {
        origin = DEFAULT_FRONTEND
      }
      const tab = tabs.find((x) => x.url && x.url.startsWith(origin))
      sendResponse({ tabId: tab?.id ?? null })
    })
    return true
  }

  sendResponse({ ok: false, error: 'unknown_message' })
  return false
})

chrome.tabs.onRemoved.addListener(() => {
  /* при закрытии вкладки цикл остановит content по флагу */
})
