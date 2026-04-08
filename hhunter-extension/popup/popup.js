function $(id) {
  return document.getElementById(id)
}

function showErr(msg) {
  const e = $('errLine')
  if (!msg) {
    e.classList.add('hidden')
    e.textContent = ''
    return
  }
  e.textContent = msg
  e.classList.remove('hidden')
}

function sendBg(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, resolve)
    } catch (e) {
      resolve({ ok: false, error: String(e) })
    }
  })
}

async function loadUiState() {
  const st = await chrome.storage.local.get(['apiBaseUrl', 'frontendOrigin', 'authToken', 'userName', 'isRunning'])
  $('apiBase').value = st.apiBaseUrl || 'http://localhost:8000'
  $('frontendOrigin').value = st.frontendOrigin || 'http://localhost:5173'

  const token = st.authToken || ''
  const guest = !token
  const running = !!st.isRunning

  $('block-guest').classList.toggle('hidden', !guest)
  $('userChip').classList.toggle('hidden', guest)
  if (!guest) {
    $('userChip').textContent = st.userName ? `● ${st.userName}` : '● аккаунт'
  }

  const tab = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (t) => resolve(t[0]))
  })
  const onHh = tab?.url && /https?:\/\/(.*\.)?hh\.ru/i.test(tab.url)

  $('block-wrong-tab').classList.add('hidden')
  $('block-ready').classList.add('hidden')
  $('block-running').classList.add('hidden')

  if (guest) return

  if (running) {
    $('block-running').classList.remove('hidden')
    return
  }

  if (!onHh) {
    $('block-wrong-tab').classList.remove('hidden')
    return
  }

  $('block-ready').classList.remove('hidden')
  const s = await sendBg({ type: 'EXTENSION_SETTINGS' })
  if (s?.ok && s.data) {
    const lim = s.data.daily_limit || 50
    $('statusLine').textContent = `Лимит: ${lim} / день (UTC). Пауза ${s.data.delay_min}–${s.data.delay_max} с.`
    $('progressLabel').textContent = `Настройки загружены · лимит ${lim}`
    $('progressFill').style.width = '0%'
    if (s.data.username) {
      $('userChip').textContent = `● ${s.data.username}`
      await chrome.storage.local.set({ userName: s.data.username })
    }
  } else {
    $('statusLine').textContent = 'Не удалось загрузить настройки. Сохраните раздел «Поиск» на сайте.'
  }
}

async function syncTokenFromFrontend() {
  showErr('')
  const fe = $('frontendOrigin').value.trim() || 'http://localhost:5173'
  await chrome.storage.local.set({ frontendOrigin: fe })

  const { tabId } = await sendBg({ type: 'FIND_FRONTEND_TAB', frontendOrigin: fe })
  if (tabId == null) {
    showErr('Откройте вкладку с сайтом HHunter (тот же URL, что в поле выше).')
    return
  }

  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (key) => localStorage.getItem(key) || '',
    args: ['hhunter_token'],
  })
  const token = res?.result || ''
  if (!token) {
    showErr('Токен не найден. Выполните вход на HHunter в этой вкладке.')
    return
  }

  let userName = ''
  try {
    const part = token.split('.')[1]
    if (part) {
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
      /* sub = user id */
      userName = ''
    }
  } catch (_) {}

  const settings = await sendBg({ type: 'EXTENSION_SETTINGS' }).catch(() => null)
  if (settings?.ok && settings.data?.username) userName = settings.data.username

  await chrome.storage.local.set({ authToken: token, userName })
  await loadUiState()
}

async function startRun() {
  showErr('')
  const st = await chrome.storage.local.get(['authToken', 'isRunning'])
  if (!st.authToken) {
    showErr('Нет токена')
    return
  }
  await chrome.storage.local.set({ isRunning: true })
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url?.includes('hh.ru')) {
    await chrome.storage.local.set({ isRunning: false })
    showErr('Активная вкладка должна быть hh.ru')
    return
  }
  chrome.tabs.sendMessage(tab.id, { type: 'HHUNTER_START' }, () => {
    void chrome.runtime.lastError
  })
  await loadUiState()
}

async function stopRun() {
  await chrome.storage.local.set({ isRunning: false })
  await loadUiState()
}

function openUrl(url) {
  chrome.tabs.create({ url })
}

$('btnOpenWeb').addEventListener('click', () => {
  openUrl($('frontendOrigin').value.trim() || 'http://localhost:5173')
})
$('btnOpenHh').addEventListener('click', () => openUrl('https://hh.ru/search/vacancy?text='))
$('btnSyncToken').addEventListener('click', () => syncTokenFromFrontend())
$('btnSaveConfig').addEventListener('click', async () => {
  showErr('')
  await sendBg({
    type: 'SET_CONFIG',
    apiBaseUrl: $('apiBase').value.trim(),
    frontendOrigin: $('frontendOrigin').value.trim(),
  })
  $('block-config').classList.add('hidden')
  await loadUiState()
})
$('btnShowConfig').addEventListener('click', () => {
  $('block-config').classList.toggle('hidden')
})

$('btnStart').addEventListener('click', () => startRun())
$('btnStop').addEventListener('click', () => stopRun())
$('btnStop2').addEventListener('click', () => stopRun())

document.addEventListener('DOMContentLoaded', () => {
  loadUiState()
})
