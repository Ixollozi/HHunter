const $ = (id) => document.getElementById(id)

function sendBg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
}

async function loadUi() {
  const st = await chrome.storage.local.get(['hhunter_api_base', 'hhunter_token'])
  $('apiBase').value = st.hhunter_api_base || 'http://localhost:8000'
  $('token').value = st.hhunter_token || ''

  const resp = await sendBg({ type: 'get_state' })
  const state = resp?.state
  const ext = resp?.ext
  $('btnToggle').textContent = state?.running ? 'Остановить' : 'Запустить'

  const model = ext?.groq_model || '—'
  const groqOk = ext?.groq_configured ? 'ключ OK' : 'ключ не задан'
  $('modelLine').textContent = `🤖 ${model} · ${groqOk}`
  const stats = state?.stats || { sent: 0, skipped: 0, error: 0 }
  $('statsLine').textContent = `Сегодня: ✅ ${stats.sent} ⏭️ ${stats.skipped} ❌ ${stats.error}`
  $('lastLine').textContent = state?.last?.message ? `Последнее: ${state.last.message}` : 'Последнее: —'
}

$('btnSave').addEventListener('click', async () => {
  const apiBase = $('apiBase').value.trim() || 'http://localhost:8000'
  const token = $('token').value.trim()
  await sendBg({ type: 'set_api_base', apiBase })
  await sendBg({ type: 'set_token', token })
  await loadUi()
})

$('btnToggle').addEventListener('click', async () => {
  const resp = await sendBg({ type: 'get_state' })
  const running = !!resp?.state?.running
  await sendBg({ type: 'set_running', running: !running })
  await loadUi()
})

loadUi()

