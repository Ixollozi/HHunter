;(function () {
  function normalizeToken(raw) {
    var t = String(raw || '').trim()
    if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, '').trim()
    return t
  }

  function pageKind() {
    const u = location.href
    if (/hh\.ru\/vacancy\/\d+/i.test(u)) return 'vacancy'
    if (u.includes('/search/vacancy')) return 'search'
    return 'other'
  }

  function detectCaptcha() {
    if (document.querySelector('[data-qa="challenge-form"], .aptcha, iframe[src*="captcha"]')) return true
    if (document.body && /капч/i.test(document.body.innerText || '')) return true
    return false
  }

  function parseVacancyIdFromUrl(url) {
    const m = String(url || '').match(/\/vacancy\/(\d+)/i)
    return m ? m[1] : ''
  }

  function collectVacancyFromPage() {
    const title =
      document.querySelector('[data-qa="vacancy-title"]')?.textContent?.trim() ||
      document.querySelector('h1')?.textContent?.trim() ||
      ''
    const company =
      document.querySelector('[data-qa="vacancy-company-name"]')?.textContent?.trim() ||
      document.querySelector('[data-qa="vacancy-company"]')?.textContent?.trim() ||
      ''
    const desc =
      document.querySelector('[data-qa="vacancy-description"]')?.innerText?.trim() ||
      document.querySelector('[data-qa="vacancy-description"]')?.textContent?.trim() ||
      document.body?.innerText?.slice(0, 20000) ||
      ''
    const vacancyUrl = location.href
    const vacancyId = parseVacancyIdFromUrl(vacancyUrl) || ''
    return { vacancy_title: title, vacancy_description: desc, company_name: company, vacancy_url: vacancyUrl, vacancy_id: vacancyId }
  }

  async function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, resolve)
      } catch (e) {
        resolve({ ok: false, error: String(e) })
      }
    })
  }

  async function runOnce() {
    if (detectCaptcha()) {
      await sendBg({
        type: 'report',
        kind: 'error',
        last: { level: 'WARNING', message: 'Капча на hh.ru — остановите и решите вручную' },
      })
      return
    }
    if (pageKind() !== 'vacancy') {
      await sendBg({
        type: 'report',
        last: { level: 'INFO', message: 'Откройте страницу вакансии hh.ru/vacancy/{id}' },
      })
      return
    }
    const payload = collectVacancyFromPage()
    if (!payload.vacancy_title || !payload.vacancy_description) {
      await sendBg({
        type: 'report',
        kind: 'skipped',
        last: { level: 'WARNING', message: 'Не удалось считать вакансию из DOM' },
      })
      return
    }

    const apiBaseRaw = (await chrome.storage.local.get('hhunter_api_base')).hhunter_api_base || 'http://localhost:8000'
    const apiBase = String(apiBaseRaw).trim().replace(/\/$/, '')
    let token = (await chrome.storage.local.get('hhunter_token')).hhunter_token || ''
    token = normalizeToken(token)
    if (!token) {
      await sendBg({
        type: 'report',
        kind: 'error',
        last: {
          level: 'ERROR',
          message: 'Нет JWT. Откройте сайт HHunter, нажмите «Токен с сайта» в расширении.',
        },
      })
      return
    }

    const res = await fetch(`${apiBase}/extension/generate-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        vacancy_title: payload.vacancy_title,
        vacancy_description: payload.vacancy_description,
        company_name: payload.company_name,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.detail || res.statusText
      await sendBg({
        type: 'report',
        kind: 'error',
        last: { level: 'ERROR', message: `generate-letter: ${msg}` },
      })
      return
    }

    const letter = (data.letter || '').trim()
    const modelUsed = data.model_used || null
    const btn =
      document.querySelector('[data-qa="vacancy-response-link-top"]') ||
      document.querySelector('[data-qa="vacancy-response-button-top"]') ||
      document.querySelector('[data-qa="vacancy-response-link"]')
    if (btn) btn.click()

    await new Promise((r) => setTimeout(r, 900))
    const ta =
      document.querySelector('textarea[name="cover_letter"]') ||
      document.querySelector('textarea') ||
      null
    if (ta) {
      ta.focus()
      ta.value = letter
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }

    await fetch(`${apiBase}/extension/save-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        vacancy_id: payload.vacancy_id || payload.vacancy_url,
        vacancy_title: payload.vacancy_title,
        vacancy_url: payload.vacancy_url,
        company_name: payload.company_name || null,
        cover_letter: letter,
        model_used: modelUsed,
        status: 'sent',
      }),
    }).catch(() => {})

    await sendBg({
      type: 'report',
      kind: 'sent',
      last: { level: 'INFO', message: `Готово: ${payload.vacancy_title}` },
    })
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'hhunter_run_once') return false
    let done = false
    function finish(payload) {
      if (done) return
      done = true
      try {
        sendResponse(payload)
      } catch {
        /* */
      }
    }
    runOnce()
      .then(() => finish({ ok: true }))
      .catch((e) => finish({ ok: false, error: String((e && e.message) || e) }))
    return true
  })
})()
