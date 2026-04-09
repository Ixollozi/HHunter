const $ = (id) => document.getElementById(id)

function sendBg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
}

async function loadUi(options) {
  const refresh = options && options.refreshSettings
  const st = await chrome.storage.local.get(['hhunter_api_base', 'hhunter_token'])
  $('apiBase').value = st.hhunter_api_base || 'http://localhost:8000'
  $('token').value = st.hhunter_token || ''

  const resp = await sendBg({ type: 'get_state', refresh_settings: !!refresh })
  const state = resp?.state
  const ext = resp?.ext
  const ho = resp?.hh_origin || 'https://hh.ru'
  const sel = $('hhOrigin')
  if (sel) {
    sel.value = [...sel.options].some((o) => o.value === ho) ? ho : 'https://hh.ru'
  }
  $('btnToggle').textContent = state?.running ? 'Остановить' : 'Запустить'
  $('fullAuto').checked = resp?.run_mode === 'full_auto'

  if (resp?.api_error) {
    $('modelLine').textContent = `⚠ ${resp.api_error}`
  } else {
    const model = ext?.groq_model || '—'
    const groqOk = ext?.groq_configured ? 'ключ OK' : 'ключ не задан'
    const sent = ext?.sent_today != null ? ext.sent_today : '—'
    const lim = ext?.daily_limit != null ? ext.daily_limit : '—'
    const sh = ext?.sent_last_hour != null ? ext.sent_last_hour : '—'
    const hl = ext?.hourly_limit != null ? ext.hourly_limit : '—'
    $('modelLine').textContent = `🤖 ${model} · ${groqOk} · день UTC ${sent}/${lim} · час ${sh}/${hl}`
  }
  const stats = state?.stats || { sent: 0, skipped: 0, error: 0 }
  const modeHint = resp?.run_mode === 'full_auto' ? ' · авто-поиск' : ' · активная вкладка'
  $('statsLine').textContent = `Цикл: ✅ ${stats.sent} ⏭️ ${stats.skipped} ❌ ${stats.error}${modeHint}`
  $('lastLine').textContent = state?.last?.message ? `Последнее: ${state.last.message}` : 'Последнее: —'
}

$('btnSave').addEventListener('click', async () => {
  const apiBase = $('apiBase').value.trim() || 'http://localhost:8000'
  const token = $('token').value.trim()
  await sendBg({ type: 'set_api_base', apiBase })
  await sendBg({ type: 'set_token', token })
  if ($('hhOrigin')) await sendBg({ type: 'set_hh_origin', origin: $('hhOrigin').value })
  await loadUi({ refreshSettings: true })
})

$('btnPullToken').addEventListener('click', async () => {
  const r = await sendBg({ type: 'pull_token_from_site' })
  if (r?.ok && r.token) {
    $('token').value = r.token
    await sendBg({ type: 'set_token', token: r.token })
    await loadUi()
  } else {
    $('lastLine').textContent = `Последнее: ${r?.error || 'Не удалось взять токен'}`
  }
})

$('btnToggle').addEventListener('click', async () => {
  const resp = await sendBg({ type: 'get_state' })
  const running = !!resp?.state?.running
  if (!running) {
    await sendBg({ type: 'set_run_mode', mode: $('fullAuto').checked ? 'full_auto' : 'active_tab' })
  }
  await sendBg({ type: 'set_running', running: !running })
  await loadUi()
})

$('fullAuto').addEventListener('change', async () => {
  await sendBg({ type: 'set_run_mode', mode: $('fullAuto').checked ? 'full_auto' : 'active_tab' })
  await loadUi()
})

const hhOriginEl = $('hhOrigin')
if (hhOriginEl) {
  hhOriginEl.addEventListener('change', async () => {
    await sendBg({ type: 'set_hh_origin', origin: hhOriginEl.value })
    await loadUi()
  })
}

loadUi()
