;(function () {
  const PROCESSED_KEY = 'hhunterProcessedVacancyIds'
  const MAX_IDS = 400

  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, resolve)
      } catch (e) {
        resolve({ ok: false, error: String(e) })
      }
    })
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms))
  }

  function randBetween(a, b) {
    return a + Math.random() * (b - a)
  }

  async function getProcessedIds() {
    const st = await chrome.storage.local.get(PROCESSED_KEY)
    const arr = st[PROCESSED_KEY]
    return Array.isArray(arr) ? arr : []
  }

  async function markProcessed(vacancyId) {
    const ids = await getProcessedIds()
    if (ids.includes(vacancyId)) return
    ids.unshift(vacancyId)
    await chrome.storage.local.set({ [PROCESSED_KEY]: ids.slice(0, MAX_IDS) })
  }

  async function isRunFlag() {
    const { isRunning: r } = await chrome.storage.local.get('isRunning')
    return !!r
  }

  function detectCaptcha() {
    if (document.querySelector('[data-qa="challenge-form"], .aptcha, iframe[src*="captcha"]')) return true
    if (document.body && /капч/i.test(document.body.innerText || '')) return true
    return false
  }

  function pageKind() {
    const u = location.href
    if (/hh\.ru\/vacancy\/\d+/i.test(u)) return 'vacancy'
    if (u.includes('/search/vacancy')) return 'search'
    return 'other'
  }

  function parseVacancyIdFromUrl(url) {
    const m = String(url || '').match(/\/vacancy\/(\d+)/i)
    return m ? m[1] : ''
  }

  /** @returns {HTMLElement | null} */
  function findRespondButton(root) {
    return (
      root.querySelector('[data-qa="vacancy-serp__vacancy_response"]') ||
      root.querySelector('a[data-qa="vacancy-serp__vacancy_response"]') ||
      root.querySelector('[data-qa="vacancy-response-link-top"]')
    )
  }

  function collectCardPayload(card) {
    const titleA =
      card.querySelector('[data-qa="serp-item__title"]') ||
      card.querySelector('a[data-qa="serp-item__title"]') ||
      card.querySelector('a.serp-item__title')
    const title = (titleA && titleA.textContent) ? titleA.textContent.trim() : ''
    const vacancyUrl = titleA && titleA.href ? titleA.href : ''
    const vid = parseVacancyIdFromUrl(vacancyUrl)
    const companyEl =
      card.querySelector('[data-qa="vacancy-serp__vacancy-employer"]') ||
      card.querySelector('[data-qa="serp-item__company-name"]')
    const companyName = companyEl ? companyEl.textContent.trim() : ''
    const parts = []
    card.querySelectorAll('[data-qa*="snippet"], [data-qa*="Snippet"]').forEach((el) => {
      const t = (el.textContent || '').trim()
      if (t) parts.push(t)
    })
    const vacancyDescription = parts.join('\n').slice(0, 8000) || title
    return { vacancy_id: vid, vacancy_title: title, company_name: companyName, vacancy_url: vacancyUrl, vacancy_description: vacancyDescription }
  }

  function collectDetailPayload() {
    const titleEl = document.querySelector('[data-qa="vacancy-title"]') || document.querySelector('h1')
    const title = titleEl ? titleEl.textContent.trim() : ''
    const companyEl = document.querySelector('[data-qa="vacancy-company-name"]')
    const companyName = companyEl ? companyEl.textContent.trim() : ''
    const descEl = document.querySelector('[data-qa="vacancy-description"]')
    const vacancyDescription = descEl ? descEl.textContent.trim().slice(0, 120_000) : ''
    const vid = parseVacancyIdFromUrl(location.href)
    return {
      vacancy_id: vid,
      vacancy_title: title,
      company_name: companyName,
      vacancy_url: location.href.split('?')[0],
      vacancy_description: vacancyDescription || title,
    }
  }

  async function waitFor(fn, timeoutMs, step = 200) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      const el = fn()
      if (el) return el
      await sleep(step)
    }
    return null
  }

  function visibleModal() {
    return document.querySelector('[data-qa="vacancy-response-popup"], .vacancy-response, [class*="ResponseStyles"]')
  }

  async function waitForSuccessSnackbar() {
    const ok = await waitFor(() => {
      const txt = document.body ? document.body.innerText : ''
      if (/отклик отправлен|отклик отправлена/i.test(txt)) return document.body
      return null
    }, 12000)
    return !!ok
  }

  /**
   * @param {{vacancy_id:string,vacancy_title:string,company_name:string,vacancy_url:string,vacancy_description:string}} payload
   */
  async function saveApp(payload, letter, status, skipReason, errMsg) {
    const res = await sendBg({
      type: 'SAVE_APPLICATION',
      payload: {
        vacancy_id: payload.vacancy_id,
        vacancy_title: payload.vacancy_title,
        vacancy_url: payload.vacancy_url,
        company_name: payload.company_name,
        cover_letter: letter || null,
        status,
        skip_reason: skipReason || null,
        error_message: errMsg || null,
      },
    })
    if (!res || !res.ok) {
      await sendBg({
        type: 'EXTENSION_LOG',
        level: 'ERROR',
        message: `save-application: ${res?.error || 'unknown'}`,
      })
    }
  }

  async function runVacancyDetailOnce() {
    if (detectCaptcha()) {
      await sendBg({ type: 'EXTENSION_LOG', level: 'WARNING', message: 'Обнаружена капча на странице вакансии' })
      await chrome.storage.local.set({ isRunning: false })
      return
    }
    const payload = collectDetailPayload()
    if (!payload.vacancy_id) return

    const btn = findRespondButton(document.body)
    if (!btn) {
      await saveApp(payload, '', 'skipped', 'no_button', null)
      return
    }
    if (btn.getAttribute('disabled') != null || btn.classList.contains('bloko-button_disabled')) {
      await saveApp(payload, '', 'skipped', 'already_applied', null)
      await markProcessed(payload.vacancy_id)
      return
    }

    btn.click()
    await sleep(800)

    const letterRes = await sendBg({
      type: 'GENERATE_LETTER',
      payload: {
        vacancy_title: payload.vacancy_title,
        vacancy_description: payload.vacancy_description,
        company_name: payload.company_name,
      },
    })
    if (!letterRes || !letterRes.ok || !letterRes.data?.letter) {
      const err = letterRes?.error || 'letter_failed'
      await sendBg({ type: 'EXTENSION_LOG', level: 'ERROR', message: `Gemini/бэкенд: ${err}` })
      await saveApp(payload, '', 'error', null, String(err).slice(0, 2000))
      return
    }
    const letter = letterRes.data.letter

    const ta =
      (await waitFor(
        () =>
          document.querySelector('textarea[name="letter"]') ||
          document.querySelector('[data-qa="vacancy-response-popup"] textarea') ||
          document.querySelector('textarea'),
        8000,
      )) || null
    if (!ta) {
      await saveApp(payload, letter, 'error', null, 'Не найдено поле письма')
      return
    }
    ta.focus()
    ta.value = letter
    ta.dispatchEvent(new Event('input', { bubbles: true }))

    const submit =
      document.querySelector('[data-qa="vacancy-response-submit-button"]') ||
      document.querySelector('button[type="submit"]')
    if (submit) submit.click()

    const ok = await waitForSuccessSnackbar()
    if (ok) {
      await saveApp(payload, letter, 'sent', null, null)
      await markProcessed(payload.vacancy_id)
    } else {
      await saveApp(payload, letter, 'error', null, 'Не дождались подтверждения отклика')
    }
  }

  async function runSearchCardOnce() {
    const cards = Array.from(
      document.querySelectorAll('[data-qa="vacancy-serp__vacancy"], div.serp-item, .magritteRedesignSerpItem'),
    )
    const processed = await getProcessedIds()

    for (const card of cards) {
      if (!(await isRunFlag())) return
      const btn = findRespondButton(card)
      if (!btn) continue
      const payload = collectCardPayload(card)
      if (!payload.vacancy_id || processed.includes(payload.vacancy_id)) continue
      if (btn.getAttribute('disabled') != null || btn.classList.contains('bloko-button_disabled')) {
        await markProcessed(payload.vacancy_id)
        continue
      }

      if (detectCaptcha()) {
        await sendBg({ type: 'EXTENSION_LOG', level: 'WARNING', message: 'Капча на странице поиска' })
        await chrome.storage.local.set({ isRunning: false })
        return
      }

      btn.scrollIntoView({ block: 'center', behavior: 'instant' })
      await sleep(400)
      btn.click()
      await sleep(900)

      const letterRes = await sendBg({
        type: 'GENERATE_LETTER',
        payload: {
          vacancy_title: payload.vacancy_title,
          vacancy_description: payload.vacancy_description,
          company_name: payload.company_name,
        },
      })
      if (!letterRes || !letterRes.ok || !letterRes.data?.letter) {
        const err = letterRes?.error || 'letter_failed'
        await sendBg({ type: 'EXTENSION_LOG', level: 'ERROR', message: err })
        await saveApp(payload, '', 'error', null, String(err).slice(0, 2000))
        try {
          const close = document.querySelector('[data-qa="vacancy-response-close"]') || document.querySelector('.bloko-modal-close')
          close && close.click()
        } catch (_) {}
        return
      }
      const letter = letterRes.data.letter

      const ta =
        (await waitFor(
          () =>
            document.querySelector('textarea[name="letter"]') ||
            document.querySelector('[data-qa="vacancy-response-popup"] textarea') ||
            document.querySelector('textarea'),
          8000,
        )) || null
      if (!ta) {
        await saveApp(payload, letter, 'error', null, 'Нет поля письма')
        try {
          const close = document.querySelector('[data-qa="vacancy-response-close"]')
          close && close.click()
        } catch (_) {}
        return
      }
      ta.focus()
      ta.value = letter
      ta.dispatchEvent(new Event('input', { bubbles: true }))

      const submit =
        document.querySelector('[data-qa="vacancy-response-submit-button"]') ||
        document.querySelector('[data-qa="vacancy-response-popup"] button[type="submit"]')
      if (submit) submit.click()

      const ok = await waitForSuccessSnackbar()
      if (ok) {
        await saveApp(payload, letter, 'sent', null, null)
        await markProcessed(payload.vacancy_id)
      } else {
        await saveApp(payload, letter, 'error', null, 'Нет подтверждения отклика')
      }

      try {
        const close = document.querySelector('[data-qa="vacancy-response-close"]') || document.querySelector('.bloko-modal-close')
        close && close.click()
        await sleep(500)
      } catch (_) {}

      return
    }
  }

  let loopActive = false

  async function runLoop() {
    if (loopActive) return
    loopActive = true
    try {
      while (await isRunFlag()) {
        if (detectCaptcha()) {
          await sendBg({ type: 'EXTENSION_LOG', level: 'WARNING', message: 'Требуется решить капчу' })
          await chrome.storage.local.set({ isRunning: false })
          break
        }
        const kind = pageKind()
        if (kind === 'vacancy') {
          await runVacancyDetailOnce()
          break
        }
        if (kind === 'search') {
          await runSearchCardOnce()
        } else {
          await sleep(1500)
          continue
        }

        const sets = await sendBg({ type: 'EXTENSION_SETTINGS' })
        const dmin = sets?.data?.delay_min ?? 3
        const dmax = sets?.data?.delay_max ?? 6
        await sleep(randBetween(dmin, dmax) * 1000)
      }
    } finally {
      loopActive = false
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'HHUNTER_START') {
      runLoop().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }))
      return true
    }
    if (msg?.type === 'HHUNTER_PING') {
      sendResponse({ ok: true, page: pageKind() })
      return false
    }
    return false
  })
})()
