const $ = (id) => document.getElementById(id)

function sendBg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
}

function applyCycleStatusUi(running) {
  const badge = $('cycleStatusBadge')
  const hint = $('cycleStatusHint')
  if (badge) {
    badge.textContent = running ? 'Активен — цикл запущен' : 'Остановлен'
    badge.className = `cycle-status ${running ? 'cycle-status--running' : 'cycle-status--stopped'}`
    badge.setAttribute('aria-label', running ? 'Цикл откликов запущен' : 'Цикл откликов остановлен')
  }
  if (hint) {
    hint.textContent = running
      ? 'Работает автоотклик или шаг по текущей вкладке. «Остановить» завершит цикл. Статус здесь и кнопка синхронизируются с фоном.'
      : 'Нажмите «Запустить» на странице вакансии hh (или включите полный цикл). Пока окно открыто, статус обновляется каждые ~2,5 с.'
  }
}

let pollTimer = null

function startStatePoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    void loadUi({ silent: true })
  }, 2500)
}

window.addEventListener('unload', () => {
  if (pollTimer) clearInterval(pollTimer)
})

async function loadUi(options) {
  const refresh = options && options.refreshSettings
  const silent = options && options.silent
  const st = await chrome.storage.local.get(['hhunter_api_base', 'hhunter_token'])
  if (!silent) {
    $('apiBase').value = st.hhunter_api_base || 'http://localhost:8000'
    $('token').value = st.hhunter_token || ''
  }

  const resp = await sendBg({ type: 'get_state', refresh_settings: !!refresh })
  const state = resp?.state
  const ext = resp?.ext
  const ho = resp?.hh_origin || 'https://hh.ru'
  const sel = $('hhOrigin')
  if (sel && !silent) {
    sel.value = [...sel.options].some((o) => o.value === ho) ? ho : 'https://hh.ru'
  }
  const running = !!state?.running
  $('btnToggle').textContent = running ? 'Остановить' : 'Запустить'
  if (!silent) {
    $('fullAuto').checked = resp?.run_mode === 'full_auto'
  }
  applyCycleStatusUi(running)

  if (resp?.api_error) {
    $('modelLine').textContent = `С сервером HHunter не удалось связаться: ${resp.api_error}`
  } else {
    const model = ext?.groq_model || 'не указана'
    const groqOk = ext?.groq_configured
      ? 'на сервере настроена генерация писем'
      : 'на сервере не настроен ключ ИИ — письма не сгенерировать'
    const sent = ext?.sent_today != null ? ext.sent_today : '—'
    const lim = ext?.daily_limit != null ? ext.daily_limit : '—'
    const sh = ext?.sent_last_hour != null ? ext.sent_last_hour : '—'
    const hl = ext?.hourly_limit != null ? ext.hourly_limit : '—'
    $('modelLine').textContent = `Модель: ${model}. ${groqOk}. Лимит откликов: сегодня ${sent} из ${lim}, за последний час ${sh} из ${hl} (счётчик на сервере).`
  }
  const stats = state?.stats || { sent: 0, skipped: 0, error: 0 }
  const modeHint =
    resp?.run_mode === 'full_auto'
      ? 'Режим: расширение само открывает поиск и вакансии.'
      : 'Режим: только страница hh, которую вы открыли сами.'
  $('statsLine').innerHTML = `В этом запуске: отправлено <span class="stats-sent" title="Успешно отправлено откликов">${stats.sent}</span>, пропущено ${stats.skipped}, ошибок ${stats.error}. ${modeHint}`
  $('lastLine').textContent = state?.last?.message
    ? `Последнее событие: ${state.last.message}`
    : 'Последнее событие: пока ничего не было.'
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
    $('lastLine').textContent = `Последнее событие: ${r?.error || 'не удалось получить код — откройте вкладку с HHunter и войдите в аккаунт.'}`
  }
})

$('btnToggle').addEventListener('click', async () => {
  const resp = await sendBg({ type: 'get_state' })
  const running = !!resp?.state?.running
  const nextRunning = !running
  applyCycleStatusUi(nextRunning)
  $('btnToggle').textContent = nextRunning ? 'Остановить' : 'Запустить'
  try {
    if (!running) {
      await sendBg({ type: 'set_run_mode', mode: $('fullAuto').checked ? 'full_auto' : 'active_tab' })
    }
    await sendBg({ type: 'set_running', running: nextRunning })
  } catch {
    /* фон мог не ответить — вернём UI из источника истины */
  }
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

void loadUi()
startStatePoll()
