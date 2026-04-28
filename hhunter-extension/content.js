;(function () {
  if (typeof window !== 'undefined' && window.__HHUNTER_CONTENT_BOUND) {
    return
  }
  if (typeof window !== 'undefined') {
    window.__HHUNTER_CONTENT_BOUND = true
  }

  // ─── utils ───────────────────────────────────────────────────────────────

  function normalizeToken(raw) {
    var t = String(raw || '').trim()
    if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, '').trim()
    return t
  }

  function pageKind() {
    const p = location.pathname || ''
    if (/\/vacancy\/\d+/i.test(p)) return 'vacancy'
    if (p.indexOf('/search/vacancy') !== -1) return 'search'
    return 'other'
  }

  function detectCaptcha() {
    if (document.querySelector('[data-qa="challenge-form"], .aptcha, iframe[src*="captcha"]')) return true
    if (document.body && /капч/i.test(document.body.innerText || '')) return true
    return false
  }

  /** Случайная пауза 5–10 с при появлении капчи (мс). */
  function captchaPauseMs() {
    return 5000 + Math.floor(Math.random() * 5001)
  }

  /**
   * Пауза 5–10 с при капче; цикл не останавливаем — после паузы сценарий продолжается.
   * (Если капча осталась, дальше сработают обычные таймауты DOM / save-application.)
   */
  async function waitCaptchaPause(apiBase, token, logStep) {
    const ms = captchaPauseMs()
    const sec = Math.round(ms / 1000)
    try {
      await postExtensionLog(
        apiBase,
        token,
        'WARNING',
        `Капча: пауза ${sec} с, затем продолжение сценария`,
        logStep || 'apply_captcha_pause',
      )
    } catch { /* */ }
    try {
      await sendBg({
        type: 'report',
        last: { level: 'INFO', message: `Капча: пауза ${sec} с…` },
      })
    } catch { /* */ }
    await sleep(ms)
    try {
      if (detectCaptcha()) {
        await postExtensionLog(
          apiBase,
          token,
          'INFO',
          'После паузы капча всё ещё на экране — продолжаем сценарий (без остановки цикла)',
          `${logStep || 'apply_captcha_pause'}_still`,
        )
      }
    } catch { /* */ }
  }

  function parseVacancyIdFromUrl(url) {
    const m = String(url || '').match(/\/vacancy\/(\d+)/i)
    return m ? m[1] : ''
  }

  function splitDescriptionAndRequirements(raw) {
    const t = String(raw || '')
    const parts = t.split(
      /\n(?=\s*(?:Требования|Мы ожидаем|Что требуется|Что нужно|Нужно|Requirements|Your profile|Для работы|Условия|Мы жд[ёе]м|Ожидаем от вас)\b)/i,
    )
    if (parts.length >= 2) {
      return {
        description: parts[0].trim(),
        vacancy_requirements: parts.slice(1).join('\n').trim().slice(0, 12000),
      }
    }
    return { description: t.trim(), vacancy_requirements: '' }
  }

  function collectKeySkillsFromPage() {
    const seen = new Set()
    const out = []
    const selectors = [
      '[data-qa="skills-element"]',
      '[data-qa="vacancy-serp__vacancy_snippet_requirement"]',
      '[data-qa="vacancy-tag"]',
      '[data-qa="bloko-tag__text"]',
    ]
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
          if (tx.length >= 2 && tx.length < 100 && !seen.has(tx.toLowerCase())) {
            seen.add(tx.toLowerCase())
            out.push(tx)
          }
        })
      } catch { /* */ }
    }
    return out.slice(0, 48).join(', ')
  }

  function collectSalaryFromPage() {
    const el =
      document.querySelector('[data-qa="vacancy-salary"]') ||
      document.querySelector('[data-qa="sidebar-salary"]') ||
      document.querySelector('[class*="vacancy-salary"]')
    const t = (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim()
    return t.slice(0, 512)
  }

  function inferSalaryCurrency(text) {
    const t = String(text || '')
    const low = t.toLowerCase()
    if (/₽|\bруб\.?|\brub\b|\brur\b/i.test(t)) return 'RUB'
    if (/\$|\busd\b/i.test(low)) return 'USD'
    if (/€|\beur\b/i.test(low)) return 'EUR'
    if (/₸|\bтенге\b|\bkzt\b/i.test(low)) return 'KZT'
    if (/so'm|so'm\.|soʻm|сум\.?|\buzs\b/i.test(low)) return 'UZS'
    if (/£|\bgbp\b/i.test(low)) return 'GBP'
    return null
  }

  /** Числа для Excel/API: [data-qa="vacancy-salary"] — «от 30 000 000 so'm», диапазоны с тире и т.д. */
  function parseSalaryFromVacancyDom() {
    const el =
      document.querySelector('[data-qa="vacancy-salary"]') ||
      document.querySelector('[data-qa="sidebar-salary"]')
    if (!el) return { salary_from: null, salary_to: null, salary_currency: null }
    const raw = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ')
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text || /договорн|обсужден|по\s+согласованию/i.test(text)) {
      return { salary_from: null, salary_to: null, salary_currency: inferSalaryCurrency(text) }
    }

    const nums = []
    const re = /(\d(?:[\d\s\u00a0]*\d|\d))/g
    let m
    while ((m = re.exec(text))) {
      const n = parseInt(m[1].replace(/[\s\u00a0]/g, ''), 10)
      if (!Number.isNaN(n) && n >= 0) nums.push(n)
    }

    const low = text.toLowerCase()
    const hasOt = /\bот\s+[\d\s\u00a0]/.test(raw) || /\bfrom\s+\d/i.test(low)
    const hasDo = /\bдо\s+[\d\s\u00a0]/.test(raw) || /\bto\s+\d/i.test(low)
    const hasRangeSep = /\d\s*[–—−]\s*\d/.test(text)

    const currency = inferSalaryCurrency(text)
    if (nums.length === 0) return { salary_from: null, salary_to: null, salary_currency: currency }

    let salary_from = null
    let salary_to = null
    if (nums.length >= 2 && (hasRangeSep || (hasOt && hasDo))) {
      salary_from = Math.min(nums[0], nums[nums.length - 1])
      salary_to = Math.max(nums[0], nums[nums.length - 1])
    } else if (nums.length >= 2 && hasOt && !hasDo) {
      salary_from = Math.min(...nums)
      salary_to = Math.max(...nums)
    } else if (nums.length === 1) {
      if (hasDo && !hasOt) salary_to = nums[0]
      else salary_from = nums[0]
    } else {
      salary_from = nums[0]
      salary_to = nums.length > 1 ? nums[nums.length - 1] : null
    }

    return {
      salary_from: salary_from != null ? salary_from : null,
      salary_to: salary_to != null ? salary_to : null,
      salary_currency: currency,
    }
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
    const descRaw =
      document.querySelector('[data-qa="vacancy-description"]')?.innerText?.trim() ||
      document.querySelector('[data-qa="vacancy-description"]')?.textContent?.trim() ||
      document.body?.innerText?.slice(0, 20000) ||
      ''
    const split = splitDescriptionAndRequirements(descRaw)
    const vacancyUrl = location.href
    const vacancyId = parseVacancyIdFromUrl(vacancyUrl) || ''
    const salNum = parseSalaryFromVacancyDom()
    return {
      vacancy_title: title,
      vacancy_description: split.description || descRaw.trim(),
      vacancy_requirements: split.vacancy_requirements || '',
      key_skills: collectKeySkillsFromPage(),
      salary_info: collectSalaryFromPage(),
      salary_from: salNum.salary_from,
      salary_to: salNum.salary_to,
      salary_currency: salNum.salary_currency,
      company_name: company,
      vacancy_url: vacancyUrl,
      vacancy_id: vacancyId,
    }
  }

  function looksLikePhoneText(s) {
    const t = String(s || '').replace(/\s+/g, ' ').trim()
    if (t.length < 5) return false
    const digits = (t.match(/\d/g) || []).length
    return digits >= 5
  }

  function readVacancyContactPhoneFromDom() {
    const el = document.querySelector('[data-qa="vacancy-contacts__phone-number"]')
    if (!el || !visibleElement(el)) return ''
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim()
    return looksLikePhoneText(txt) ? txt : ''
  }

  function findSvyazatsyaClickTarget() {
    const labelSpans = document.querySelectorAll('span[class*="magritte-button__label"]')
    for (const span of labelSpans) {
      const tx = (span.textContent || '').replace(/\s+/g, ' ').trim()
      if (tx !== 'Связаться') continue
      let node = span
      for (let i = 0; i < 10 && node; i++) {
        if (node.matches && node.matches('button, [role="button"], a')) {
          if (visibleElement(node) && isSubmitLikeClickable(node)) return node
        }
        node = node.parentElement
      }
      const view = span.closest('span[class*="magritte-button-view"]')
      if (view && visibleElement(view)) return view
    }
    const candidates = document.querySelectorAll('button, [role="button"], a')
    for (const b of candidates) {
      const tx = labelOf(b)
      if (tx === 'Связаться' && visibleElement(b) && isSubmitLikeClickable(b)) return b
    }
    return null
  }

  function readVacancyContactNameFromDom() {
    const selectors = [
      '[data-qa="vacancy-contacts__fio"]',
      '[data-qa="vacancy-contacts__name"]',
      '[data-qa="vacancy-contacts-recruiter-name"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (!el || !visibleElement(el)) continue
      const nm = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (nm.length >= 2 && nm.length < 512) return nm.slice(0, 512)
    }
    return ''
  }

  async function tryCollectVacancyContact(timeoutMs, apiBase, token) {
    const t = timeoutMs || 10000
    const out = { contact_phone: '', contact_name: '', reason_code: '' }

    let phone = readVacancyContactPhoneFromDom()
    if (phone) {
      out.contact_phone = phone.slice(0, 128)
      out.contact_name = readVacancyContactNameFromDom()
      out.reason_code = 'contact_ok_dom'
      return out
    }

    const btn = findSvyazatsyaClickTarget()
    if (!btn) {
      out.reason_code = 'contact_btn_missing'
      try { await postExtensionLog(apiBase, token, 'INFO', 'Контакты: кнопка «Связаться» не найдена', 'contact_btn_missing') } catch { /* */ }
      return out
    }

    try {
      btn.click()
    } catch {
      out.reason_code = 'contact_btn_click_failed'
      try { await postExtensionLog(apiBase, token, 'WARNING', 'Контакты: не удалось нажать «Связаться»', 'contact_btn_click_failed') } catch { /* */ }
      return out
    }

    phone =
      (await waitUntil(() => {
        const p = readVacancyContactPhoneFromDom()
        return p || null
      }, t, 180)) || ''

    out.contact_phone = phone.slice(0, 128)
    out.contact_name = readVacancyContactNameFromDom()
    if (!out.contact_phone) {
      out.reason_code = 'contact_phone_missing'
      try { await postExtensionLog(apiBase, token, 'INFO', 'Контакты: телефон не появился после «Связаться»', 'contact_phone_missing') } catch { /* */ }
    } else {
      out.reason_code = 'contact_ok_after_click'
    }

    try {
      const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
      document.body.dispatchEvent(ev)
      document.dispatchEvent(ev)
      await sleep(220)
    } catch { /* */ }

    return out
  }

  function setNativeValue(el, value) {
    if (!el) return
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
    if (el instanceof HTMLTextAreaElement && proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      if (desc && desc.set) desc.set.call(el, value)
      else el.value = value
    } else {
      el.value = value
    }
    if (typeof InputEvent !== 'undefined') {
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    } else {
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms))
  }

  async function waitUntil(fn, timeoutMs, stepMs) {
    const step = stepMs || 200
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      const v = fn()
      if (v) return v
      await sleep(step)
    }
    return null
  }

  function visibleElement(el) {
    if (!el || !(el instanceof Element)) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = window.getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false
    return true
  }

  function labelOf(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  }

  function isSubmitLikeClickable(el) {
    if (!el || !(el instanceof Element)) return false
    const node = el.closest('button, [role="button"]') || el
    if (node.disabled) return false
    if (node.getAttribute('aria-disabled') === 'true') return false
    if (node.hasAttribute('disabled')) return false
    if (node.classList && node.classList.contains('bloko-button_disabled')) return false
    const cs = window.getComputedStyle(node)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    if (cs.pointerEvents === 'none') return false
    return true
  }

  // ─── DOM: modal / form detection ─────────────────────────────────────────

  function responseModal() {
    return document.querySelector(
      '[data-qa="vacancy-response-popup"], [data-qa="vacancy-response-drawer"], [data-qa="vacancy-response-sidebar"]',
    )
  }

  function findLetterTextarea() {
    const modal = responseModal()
    const formShell = document.querySelector('[data-qa="vacancy-response-form"]')
    const root = modal || formShell || document
    return (
      root.querySelector('textarea[name="cover_letter"]') ||
      root.querySelector('textarea[data-qa="vacancy-response-popup-form-letter-input"]') ||
      root.querySelector('textarea[data-qa*="letter"]') ||
      root.querySelector('textarea[data-qa*="response"]') ||
      root.querySelector('textarea[placeholder*="исьм"]') ||
      root.querySelector('textarea[placeholder*="etter"]') ||
      root.querySelector('textarea[placeholder*="хат"]') ||
      root.querySelector('textarea')
    )
  }

  async function ensureLetterTextareaVisible() {
    // Если textarea уже видна — ничего не делаем
    let ta = findLetterTextarea()
    if (ta && visibleElement(ta)) return ta

    // Ищем toggle-кнопку «Приложить сопроводительное письмо»
    const toggle = document.querySelector('[data-qa="vacancy-response-letter-toggle"]')
    if (toggle && visibleElement(toggle)) {
      toggle.click()
      await sleep(400)
      ta = await waitUntil(() => {
        const t = findLetterTextarea()
        return t && visibleElement(t) ? t : null
      }, 5000, 150)
      return ta
    }
    return null
  }

  // ─── Country/region mismatch dialog ──────────────────────────────────────

  function textSuggestsCountryOrRegionMismatch(text) {
    const t = String(text || '').slice(0, 8000)
    return /друг(ой|ая|ого|ом)\s+(стран|страны|государств|регион)|стран[аы]\s+(проживания|не\s+совпадает)|гражданин(ом)?\s+друг|ваканси[яи]\s+в\s+друг|не\s+совпадает\s+с\s+регион|резидентств|откликаетесь\s+из\s+друг|вакансия\s+в\s+друг|релокац|relocate|different\s+country|living\s+in|с\s+другой\s+страны/i.test(t)
  }

  function countryMismatchDialogRoot() {
    try {
      const nodes = document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
      for (const el of nodes) {
        if (!visibleElement(el)) continue
        if (textSuggestsCountryOrRegionMismatch(el.innerText || '')) return el
      }
    } catch { /* */ }
    return null
  }

  function tryDismissCountryMismatchModal() {
    const roots = []

    // Быстрый путь: кнопки с явными data-qa от HH
    const confirmBtn = document.querySelector('[data-qa="relocation-warning-confirm"]')
    if (confirmBtn && visibleElement(confirmBtn) && isSubmitLikeClickable(confirmBtn)) {
      confirmBtn.click()
      return true
    }

    try {
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => {
        if (visibleElement(el)) roots.push(el)
      })
    } catch { /* */ }
    if (roots.length === 0) {
      try {
        document.querySelectorAll('[data-qa*="modal"]').forEach((el) => {
          if (visibleElement(el) && (el.innerText || '').length > 20) roots.push(el)
        })
      } catch { /* */ }
    }
    for (const root of roots) {
      const inner = root.innerText || ''
      if (!textSuggestsCountryOrRegionMismatch(inner)) continue
      const buttons = root.querySelectorAll('button, [role="button"], a.bloko-button, a[class*="Button"]')
      for (const b of buttons) {
        if (!visibleElement(b) || !isSubmitLikeClickable(b)) continue
        const label = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()
        if (/вс[её е]\s*равно/i.test(label) && /отклик|продолж|подать|остав/i.test(label)) {
          b.click()
          return true
        }
        if (/продолжить.{0,30}отклик|да,?\s*.{0,20}отклик/i.test(label)) {
          b.click()
          return true
        }
      }
      for (const b of buttons) {
        if (!visibleElement(b) || !isSubmitLikeClickable(b)) continue
        const label = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()
        if (/^продолжить$/i.test(label) || /^вс[её]\s*равно$/i.test(label)) {
          b.click()
          return true
        }
      }
    }
    return false
  }

  // ─── Chat composer detection ──────────────────────────────────────────────

  function findChatComposerField() {
    try {
      const shells = document.querySelectorAll(
        '[data-qa*="chat"], [class*="chat-panel"], [class*="ChatComposer"], [data-qa*="messenger"], [class*="Messenger"]',
      )
      for (const shell of shells) {
        if (!visibleElement(shell)) continue
        const ta = shell.querySelector('textarea')
        if (ta && visibleElement(ta)) return ta
        const ed = shell.querySelector('[contenteditable="true"]')
        if (ed && visibleElement(ed)) return ed
      }
    } catch { /* */ }
    const rm = responseModal()
    const fields = document.querySelectorAll('textarea, [contenteditable="true"]')
    for (const el of fields) {
      if (!visibleElement(el)) continue
      if (rm && rm.contains(el)) continue
      const ph = (el.getAttribute('placeholder') || '').toLowerCase()
      if (/сообщени|message|чат|chat|напишите|ваш(е)?\s+сообщ/i.test(ph)) return el
    }
    for (const el of fields) {
      if (!visibleElement(el)) continue
      if (rm && rm.contains(el)) continue
      const host = el.closest('[role="dialog"], aside, [data-qa*="chat"], [data-qa*="drawer"]')
      if (host && visibleElement(host)) return el
    }
    return null
  }

  function findChatComposerFieldGlobal() {
    const found = findChatComposerField()
    if (found) return found
    try {
      const boxes = document.querySelectorAll('[role="textbox"]')
      for (const el of boxes) {
        if (!visibleElement(el)) continue
        const ph = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase()
        const inChatShell = el.closest(
          '[data-qa*="chat"],[data-qa*="messenger"],[class*="chat"],[class*="Messenger"],aside,[role="dialog"]',
        )
        const rm = responseModal()
        const qa = (el.getAttribute('data-qa') || '').toLowerCase()
        const inLetterForm =
          rm &&
          rm.contains(el) &&
          (el.matches('textarea[name="cover_letter"]') || qa.indexOf('letter') !== -1 || qa.indexOf('response') !== -1)
        if (inLetterForm) continue
        if (inChatShell || /сообщ|message|чат|chat|напишите|ваш(е)?\s+сообщ|reply/i.test(ph)) return el
      }
    } catch { /* */ }
    try {
      const iframes = document.querySelectorAll('iframe')
      for (const fr of iframes) {
        let doc = null
        try { doc = fr.contentDocument } catch { doc = null }
        if (!doc) continue
        const inner =
          doc.querySelector('textarea') ||
          doc.querySelector('[contenteditable="true"]') ||
          doc.querySelector('[role="textbox"]')
        if (inner && visibleElement(inner)) return inner
      }
    } catch { /* */ }
    return null
  }

  function findChatSendButtonNear(field) {
    if (!field) return null
    let node = field
    for (let d = 0; d < 14 && node; d += 1) {
      const root = node
      if (root.querySelectorAll) {
        const buttons = root.querySelectorAll('button, [role="button"]')
        for (const b of buttons) {
          if (!visibleElement(b) || !isSubmitLikeClickable(b)) continue
          const t = labelOf(b)
          if (/^отправить$/i.test(t) || /^send$/i.test(t) || /отправить\s+сообщ/i.test(t)) return b
          const qa = b.getAttribute('data-qa') || ''
          if (/send|submit/i.test(qa) && /chat|message|messenger/i.test(qa)) return b
        }
      }
      node = node.parentElement
    }
    return null
  }

  function setMessageFieldValue(el, text) {
    if (!el) return
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      setNativeValue(el, text)
      return
    }
    if (el.isContentEditable) {
      el.focus()
      try {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, text)
      } catch {
        el.textContent = text
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
        } catch {
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
      return
    }
    if (el.getAttribute && el.getAttribute('role') === 'textbox') {
      el.textContent = text
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }

  // ─── Chat opener (variant 3: country warning) ─────────────────────────────

  /**
   * Ищем ссылку или кнопку чата только внутри диалога «другая страна».
   * Возвращаем { el, hasHref } — hasHref для настоящей <a> с http(s) href.
   */
  function findEmployerChatOpenerEx() {
    // Ищем ТОЛЬКО внутри диалога предупреждения о стране
    const dlg = countryMismatchDialogRoot()
    if (!dlg) return null

    // Ищем ссылку на конкретный чат /chat/{id} внутри диалога
    for (const a of dlg.querySelectorAll('a[href]')) {
      if (!visibleElement(a)) continue
      const href = a.href || ''
      // Только прямая ссылка на чат с конкретным ID, не список переговоров
      if (/\/chat\/\d+/i.test(href)) {
        return { el: a, hasHref: true }
      }
    }

    // Ищем кнопку чата по тексту внутри диалога
    for (const el of dlg.querySelectorAll('button, [role="button"], a')) {
      if (!visibleElement(el) || !isSubmitLikeClickable(el)) continue
      const t = labelOf(el)
      if (/написать\s+в\s+чат|чат\s+с\s+работод|открыть\s+чат/i.test(t)) {
        const isAnchor = el instanceof HTMLAnchorElement && /^https?:/i.test(el.href || '')
        return { el, hasHref: isAnchor }
      }
    }

    return null
  }

  // ─── UI state machine ─────────────────────────────────────────────────────

  /**
   * Определяем текущее состояние UI на странице вакансии.
   *
   * Варианты:
   *   'warning'  — диалог о несовпадении страны/региона
   *   'form'     — обычная форма со textarea для письма (вариант 1)
   *   'chat'     — чат-поле уже видно (вариант 2)
   *   'simple'   — модалка/кнопка без поля письма (вариант 4)
   *   'none'     — ничего ещё не видно
   */
  function detectApplyUiState() {
    if (countryMismatchDialogRoot()) return 'warning'
    const formTa = findLetterTextarea()
    if (formTa && visibleElement(formTa)) return 'form'
    const chatEl = findChatComposerFieldGlobal()
    if (chatEl && visibleElement(chatEl)) return 'chat'

    // Вариант 4: ТОЛЬКО если модалка уже открыта, но письма нет
    const modal = responseModal()
    if (modal && visibleElement(modal)) {
      const sub = findSubmitButton()
      if (sub && visibleElement(sub) && isSubmitLikeClickable(sub)) return 'simple'
    }
    // findDirectApplyButton() здесь НЕ вызываем — это кнопка открытия формы, не отклика без письма

    return 'none'
  }

  /**
   * Кнопка прямого отклика без модалки и без письма (вариант 4 на некоторых страницах hh.uz).
   */
  function findDirectApplyButton() {
    const selectors = [
      '[data-qa="vacancy-response-link-top"]',
      '[data-qa="vacancy-response-button-top"]',
      '[data-qa="vacancy-response-link"]',
      '[data-qa="vacancy-sidebar-response-link"]',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && visibleElement(el) && isSubmitLikeClickable(el)) {
        // Это кнопка открытия формы — только если форма ещё НЕ открыта
        const modal = responseModal()
        if (!modal) return el
      }
    }
    return null
  }

  async function waitForApplyUiState(totalMs, stepMs) {
    const step = stepMs != null ? stepMs : 160
    const t0 = Date.now()
    let n = 0
    while (Date.now() - t0 < totalMs) {
      const s = detectApplyUiState()
      if (s !== 'none') return s
      n += 1
      const bump = n % 6 === 0 ? 400 : n % 3 === 0 ? 180 : 0
      await sleep(step + bump)
    }
    return detectApplyUiState()
  }

  // ─── Submit button ────────────────────────────────────────────────────────

  function gatherSubmitCandidates() {
    const modal = responseModal()
    const roots = []
    if (modal) roots.push(modal)
    const formShell = document.querySelector('[data-qa="vacancy-response-form"], [data-qa="vacancy-response"]')
    if (formShell) roots.push(formShell)
    roots.push(document.body)
    const seen = new Set()
    const out = []
    function push(el) {
      if (!el || !(el instanceof Element)) return
      const target = el.closest('button, [role="button"], a') || el
      if (!(target instanceof Element)) return
      if (seen.has(target)) return
      seen.add(target)
      out.push(target)
    }
    const selectors = [
      '[data-qa="vacancy-response-submit-popup"]',
      '[data-qa="vacancy-response-submit-button"]',
      '[data-qa="vacancy-response-letter-submit"]',
      '[data-qa="vacancy-response-send"]',
      '[data-qa="vacancy-response-submit"]',
      'button[data-qa*="vacancy-response"][data-qa*="submit"]',
    ]
    for (const root of roots) {
      for (const sel of selectors) {
        try { root.querySelectorAll(sel).forEach(push) } catch { /* */ }
      }
    }
    document.querySelectorAll('form').forEach((form) => {
      const a = form.getAttribute('action') || ''
      const hasLetter =
        form.querySelector('textarea[name="cover_letter"]') || form.querySelector('textarea[name*="letter"]')
      if (hasLetter || /response|negotiation|отклик/i.test(a)) {
        form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach(push)
      }
    })
    const labelRe = /отправить(\s+отклик)?|подать\s+отклик|отправить\s+письмо|^отправить$|^откликнуться$/i
    roots.forEach((root) => {
      root.querySelectorAll('button, [role="button"], a[class*="Button"], a.bloko-button').forEach((b) => {
        const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()
        if (labelRe.test(t)) push(b)
      })
    })
    return out
  }

  function findSubmitButton() {
    for (const el of gatherSubmitCandidates()) {
      if (isSubmitLikeClickable(el)) return el
    }
    return null
  }

  // ─── Success detection ────────────────────────────────────────────────────

  function detectApplySuccess() {
    const t = (document.body && document.body.innerText) || ''
    if (/отклик\s+отправлен|отклик\s+успешно|ваш\s+отклик|мы\s+свяжемся|спасибо\s+за\s+отклик|вы\s+откликнулись/i.test(t)) return true
    if (document.querySelector('[data-qa="success-screen"]')) return true
    if (document.querySelector('[data-qa="vacancy-response-success"]')) return true
    return false
  }

  function waitApplySuccess(timeoutMs) {
    const t0 = Date.now()
    return new Promise((resolve) => {
      const id = setInterval(() => {
        if (detectApplySuccess()) { clearInterval(id); resolve(true); return }
        if (Date.now() - t0 > timeoutMs) { clearInterval(id); resolve(false) }
      }, 200)
    })
  }

  // ─── Background / API bridge ──────────────────────────────────────────────

  async function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, resolve)
      } catch (e) {
        resolve({ ok: false, error: String(e) })
      }
    })
  }

  function extensionApi(path, method, jsonBody) {
    return new Promise((resolve, reject) => {
      const body =
        jsonBody === undefined || jsonBody === null
          ? undefined
          : typeof jsonBody === 'string'
            ? jsonBody
            : JSON.stringify(jsonBody)
      chrome.runtime.sendMessage({ type: 'hhunter_api', path, method: method || 'GET', body }, (r) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return }
        if (r && r.networkError) { reject(new Error(r.networkError)); return }
        if (!r || !r.handled) { reject(new Error((r && r.error) || 'hhunter_api: нет ответа')); return }
        resolve({ status: r.status, ok: r.statusOk, data: r.data })
      })
    })
  }

  function postExtensionLog(_apiBase, _token, level, message, step) {
    const msg = String(message || '').slice(0, 3800)
    if (!msg) return Promise.resolve()
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'hhunter_api',
          path: '/extension/log',
          method: 'POST',
          body: JSON.stringify({
            level: String(level || 'INFO').toUpperCase(),
            message: msg,
            source: 'extension_content',
            step: step || null,
          }),
        },
        () => resolve(),
      )
    })
  }

  /** Человекочитаемое описание ошибки генерации; сырой текст API оставляем как есть. */
  function ruGenerateLetterLogDetail(detail) {
    const d = String(detail || '').trim()
    if (!d) return '(пусто)'
    if (d === 'Failed to fetch' || /^failed to fetch$/i.test(d)) {
      return 'Нет сети или сервер недоступен (Failed to fetch)'
    }
    return d
  }

  // ─── Chat send helpers ────────────────────────────────────────────────────

  async function waitForComposerWithRetries(getter, totalMs) {
    const delays = [120, 200, 320, 500, 800, 1200, 1600]
    const t0 = Date.now()
    let i = 0
    while (Date.now() - t0 < totalMs) {
      const el = getter()
      if (el) return el
      const d = delays[Math.min(i, delays.length - 1)]
      i += 1
      await sleep(d)
    }
    return getter()
  }

  async function tryFillAndSendChatComposer(letter, apiBase, token, savePayload, maxWaitMs) {
    const mw = maxWaitMs != null ? maxWaitMs : 22000
    const input = await waitForComposerWithRetries(() => findChatComposerFieldGlobal(), mw)
    if (!input) return null
    setMessageFieldValue(input, letter)
    await sleep(180)
    await postExtensionLog(apiBase, token, 'INFO', 'Текст письма вставлен в чат', 'apply_chat_letter_set')
    let btn = findChatSendButtonNear(input)
    if (!btn) {
      btn = await waitUntil(() => findChatSendButtonNear(input), 6500, 160)
    }
    if (!btn) {
      await postExtensionLog(apiBase, token, 'WARNING', 'Кнопка «Отправить» в чате не найдена', 'apply_chat_send_missing')
      return { ok: false, error: 'chat_send_missing', via_chat: true }
    }
    btn.click()
    await sleep(280)
    await postExtensionLog(apiBase, token, 'SUCCESS', 'Сообщение отправлено в чат работодателя', 'apply_chat_sent')
    let sa = null
    try {
      sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
    } catch { /* */ }
    if (sa && sa.status === 409) {
      await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
      return { ok: true, submitted: false, via_chat: true, error: 'duplicate' }
    }
    await sendBg({ type: 'report', kind: 'sent', last: { level: 'SUCCESS', message: `Отправлено в чат: ${savePayload.vacancy_title}` } })
    return { ok: true, submitted: true, via_chat: true }
  }

  async function finishIfChatComposerReady(letter, apiBase, token, savePayload, maxWaitMs) {
    const fillRes = await tryFillAndSendChatComposer(letter, apiBase, token, savePayload, maxWaitMs)
    if (!fillRes) return null
    if (fillRes.error === 'duplicate') return { ok: true, submitted: false, via_chat: true, error: 'duplicate' }
    if (!fillRes.ok) return { ok: true, submitted: false, via_chat: true, error: fillRes.error || 'chat_failed' }
    return { ok: true, submitted: true, via_chat: true }
  }

  async function pasteChatComposerSemiOnly(letter, apiBase, token, savePayload, maxWaitMs) {
    const mw = maxWaitMs != null ? maxWaitMs : 20000
    const input = await waitForComposerWithRetries(() => findChatComposerFieldGlobal(), mw)
    if (!input) return null
    setMessageFieldValue(input, letter)
    await sleep(120)
    await postExtensionLog(apiBase, token, 'INFO', 'Полуавто: текст в чате (отправьте вручную)', 'apply_semi_chat_only_paste')
    try {
      await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
    } catch { /* */ }
    await sendBg({
      type: 'report',
      kind: 'sent',
      last: { level: 'INFO', message: `Полуавто: вставлено в чат — отправьте сами на hh: ${savePayload.vacancy_title.slice(0, 50)}` },
    })
    return { ok: true, submitted: false, via_chat: true }
  }

  // ─── Variant 3: country warning → chat path ───────────────────────────────

  /**
   * Обрабатывает вариант 3: диалог «другая страна» → чат.
   *
   * Стратегия:
   * 1. Если у ссылки/кнопки есть href — открываем в новой вкладке (target=_blank).
   *    Канал к background НЕ рвётся. Ждём поле в текущей вкладке (маловероятно)
   *    или сохраняем отклик с пометкой chat_new_tab.
   * 2. Если href нет (кнопка без якоря) — ставим nav_guard и кликаем в текущей вкладке.
   *    Background подхватит отклик через tryRecoverApplyAfterContentNav.
   *
   * @returns {{ tried, ok, submitted?, via_chat?, chat_new_tab?, error? }}
   */
  async function handleCountryWarningChatPath(letter, apiBase, token, savePayload, autoSubmit) {
    const openerInfo = findEmployerChatOpenerEx()
    if (!openerInfo) return { tried: false }

    const { el: opener, hasHref } = openerInfo

    await postExtensionLog(
      apiBase, token, 'INFO',
      `Предупреждение о стране: кнопка чата найдена, есть ссылка (hasHref)=${hasHref}, автоотправка (autoSubmit)=${autoSubmit}`,
      'apply_warning_chat_found',
    )

    // ── Новая вкладка (есть href) ─────────────────────────────────────────
    if (hasHref) {
      // Не кликаем — HH перехватывает и навигирует текущую вкладку.
      // Передаём URL в background, он откроет новую вкладку сам.
      const chatUrl = opener.href
      await postExtensionLog(
        apiBase, token, 'INFO',
        `Чат: URL передан во фон расширения (background) для новой вкладки: ${chatUrl}`,
        'apply_warning_chat_bg_open',
      )

      // Сохраняем отклик до навигации
      try {
        await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      } catch { /* */ }

      await sendBg({
        type: 'report',
        kind: 'sent',
        last: {
          level: 'INFO',
          message: `Чат открыт в новой вкладке (письмо сохранено в HHunter): ${savePayload.vacancy_title.slice(0, 52)}`,
        },
      })

      // Просим background открыть чат в новой вкладке
      await sendBg({ type: 'open_chat_tab', url: chatUrl })

      return { tried: true, ok: true, submitted: false, via_chat: true, chat_new_tab: true }
    }

    // ── Та же вкладка (нет href) ──────────────────────────────────────────
    // В полуавто режиме НЕ кликаем — чат убьёт канал к background
    if (!autoSubmit) {
      await postExtensionLog(
        apiBase, token, 'INFO',
        'Полуавто + чат без ссылки (href): клик пропущен (сообщение к фону оборвётся). Нажмите «Всё равно откликнуться» вручную.',
        'apply_semi_warning_no_href_skip',
      )
      return { tried: false }
    }

    // Полный авто: ставим nav_guard, кликаем — background восстановит отклик
    let guardSet = false
    try {
      const g = await sendBg({ type: 'hhunter_apply_nav_guard', savePayload, semiAuto: false })
      guardSet = !!(g && g.ok)
    } catch { /* */ }

    if (!guardSet) {
      await postExtensionLog(
        apiBase, token, 'WARNING',
        'Защита навигации (nav_guard) не сохранена — клик отменён, чтобы не потерять отклик',
        'apply_nav_guard_fail',
      )
      return { tried: false }
    }

    await postExtensionLog(
      apiBase, token, 'INFO',
      'Клик по кнопке чата в той же вкладке (nav_guard установлен)',
      'apply_chat_same_tab_click',
    )
    opener.click()
    await sleep(600)

    // Даём шанс чату открыться в текущей вкладке (если не навигация)
    const inputAfter = await waitForComposerWithRetries(() => findChatComposerFieldGlobal(), 8000)
    if (inputAfter) {
      await sendBg({ type: 'hhunter_apply_nav_guard_clear' })
      const r = await finishIfChatComposerReady(letter, apiBase, token, savePayload, 20000)
      if (r) return { tried: true, ...r }
    }

    // Вкладка уже перешла или идёт переход — background подхватит через nav_guard
    await postExtensionLog(
      apiBase, token, 'INFO',
      'Вкладка перешла после клика по чату — отклик подхватит фон (nav_guard)',
      'apply_chat_navigated',
    )
    return { tried: true, ok: true, submitted: true, via_chat: true, navigated: true }
  }

  // ─── Variant 4: letterless apply (simple button) ──────────────────────────

  async function handleSimpleApply(apiBase, token, savePayload, autoSubmit) {
    await postExtensionLog(apiBase, token, 'INFO', 'Отклик без поля письма (вариант 4)', 'apply_simple_start')

    if (!autoSubmit) {
      // Полуавто: просто сохраняем как draft
      let sa = null
      try {
        sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      } catch { sa = null }
      if (sa && sa.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: false, error: 'duplicate', letterless: true }
      }
      await sendBg({
        type: 'report',
        kind: 'sent',
        last: { level: 'INFO', message: `Черновик (без поля письма): ${savePayload.vacancy_title} — нажмите отклик вручную` },
      })
      return { ok: true, submitted: false, letterless: true }
    }

    // Модалка уже должна быть открыта когда мы сюда попадаем

    const subBtn = await waitUntil(() => {
      const s = findSubmitButton()
      return s && isSubmitLikeClickable(s) ? s : null
    }, 12000, 180)

    if (!subBtn) {
      await postExtensionLog(apiBase, token, 'WARNING', 'Кнопка «Откликнуться» не найдена (вариант 4)', 'apply_simple_btn_missing')
      try {
        await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'error', error_message: 'simple_submit_btn_missing' })
      } catch { /* */ }
      try {
        await extensionApi('/extension/blacklist-vacancy', 'POST', { vacancy_id: savePayload.vacancy_id, reason: 'submit_btn_missing' })
      } catch { /* */ }
      await sendBg({ type: 'report', kind: 'error', last: { level: 'WARNING', message: 'Кнопка отправки не найдена (вариант 4).' } })
      return { ok: true, submitted: false, error: 'simple_submit_btn_missing', letterless: true }
    }

    await postExtensionLog(apiBase, token, 'INFO', 'Клик по «Откликнуться» (вариант 4)', 'apply_simple_click')
    subBtn.click()
    await sleep(360)

    // Закрываем возможные модалки о стране после клика
    for (let j = 0; j < 12; j += 1) {
      if (tryDismissCountryMismatchModal()) await sleep(240)
      else break
    }

    if (detectCaptcha()) {
      await waitCaptchaPause(apiBase, token, 'apply_simple_captcha_pause')
    }

    const successL = await waitApplySuccess(12000)
    if (successL) {
      try {
        const sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
        if (sa && sa.status === 409) {
          await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
          return { ok: true, submitted: false, error: 'duplicate', letterless: true }
        }
        if (sa && sa.status === 429) {
          await sendBg({ type: 'report', kind: 'error', stop_loop: true, last: { level: 'WARNING', message: 'Лимит откликов (UTC) — цикл остановлен.' } })
          return { ok: true, submitted: true, error: 'server_limit', letterless: true }
        }
      } catch { /* */ }
      await postExtensionLog(apiBase, token, 'INFO', `Отклик без письма подтверждён: ${savePayload.vacancy_title.slice(0, 80)}`, 'apply_simple_ok')
      await sendBg({ type: 'report', kind: 'sent', last: { level: 'INFO', message: `Готово (без поля письма): ${savePayload.vacancy_title}` } })
      return { ok: true, submitted: true, letterless: true }
    }

    await postExtensionLog(
      apiBase, token, 'WARNING',
      'Вариант 4: успех не подтверждён по разметке страницы (DOM)',
      'apply_simple_unconfirmed',
    )
    try {
      await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'error', error_message: 'simple_not_confirmed' })
    } catch { /* */ }
    await sendBg({ type: 'report', kind: 'error', last: { level: 'WARNING', message: 'Не подтверждена отправка (вариант 4). Проверьте на hh.' } })
    return { ok: true, submitted: false, error: 'submit_not_confirmed', letterless: true }
  }

  // ─── Variant: form exists, but we intentionally don't use cover letter ────
  async function handleNoLetterForm(apiBase, token, savePayload, autoSubmit) {
    await postExtensionLog(apiBase, token, 'INFO', 'Режим без письма: отправка формы без сопроводительного', 'apply_none_form_start')

    if (!autoSubmit) {
      let sa = null
      try {
        sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      } catch { sa = null }
      if (sa && sa.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: false, error: 'duplicate', no_letter: true }
      }
      await sendBg({
        type: 'report',
        kind: 'sent',
        last: { level: 'INFO', message: `Черновик (без письма): ${savePayload.vacancy_title} — нажмите отправить на hh` },
      })
      return { ok: true, submitted: false, no_letter: true }
    }

    const subBtn = await waitUntil(() => {
      const s = findSubmitButton()
      return s && isSubmitLikeClickable(s) ? s : null
    }, 6500, 160)

    if (!subBtn) {
      await postExtensionLog(apiBase, token, 'WARNING', 'Режим без письма: кнопка отправки не найдена', 'apply_none_form_submit_missing')
      try {
        await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'error', error_message: 'none_form_submit_missing' })
      } catch { /* */ }
      await sendBg({ type: 'report', kind: 'error', last: { level: 'WARNING', message: 'Не найдена кнопка отправки (без письма).' } })
      return { ok: true, submitted: false, error: 'none_form_submit_missing', no_letter: true }
    }

    await postExtensionLog(apiBase, token, 'INFO', 'Клик по отправке (форма без письма)', 'apply_none_form_submit_click')
    subBtn.click()
    // Минимальная пауза после клика — дальше ждём подтверждение (но в быстрым таймаутом для none-режима).
    await sleep(160)

    for (let j = 0; j < 20; j += 1) {
      if (tryDismissCountryMismatchModal()) {
        await postExtensionLog(apiBase, token, 'INFO', 'После отправки: закрыто предупреждение о стране', 'apply_none_country_modal_after_submit')
        await sleep(220)
      } else break
    }

    if (detectCaptcha()) {
      await waitCaptchaPause(apiBase, token, 'apply_none_form_captcha_pause')
    }

    // В none-режиме ждём подтверждение меньше, чтобы не тормозить цикл на медленном DOM.
    const success = await waitApplySuccess(3000)
    if (!success) {
      await postExtensionLog(
        apiBase,
        token,
        'WARNING',
        'Без письма: быстрый таймаут подтверждения (DOM). Переходим дальше, не блокируя цикл.',
        'apply_none_form_fast_timeout',
      )
      // Не пишем status=error: часто hh просто не успевает отрисовать success-блок, но отклик уже отправлен.
      try {
        await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      } catch { /* */ }
      await sendBg({
        type: 'report',
        kind: 'sent',
        last: { level: 'INFO', message: `Отправлено (без письма, без подтверждения DOM): ${savePayload.vacancy_title}` },
      })
      return { ok: true, submitted: true, no_letter: true, unconfirmed: true }
    }

    try {
      const sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      if (sa && sa.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: true, error: 'duplicate', no_letter: true }
      }
      if (sa && sa.status === 429) {
        await sendBg({ type: 'report', kind: 'error', stop_loop: true, last: { level: 'WARNING', message: 'Лимит откликов (UTC) — цикл остановлен.' } })
        return { ok: true, submitted: true, error: 'server_limit', no_letter: true }
      }
    } catch { /* */ }
    await postExtensionLog(apiBase, token, 'SUCCESS', `Без письма: отклик подтверждён: ${savePayload.vacancy_title.slice(0, 80)}`, 'apply_none_form_ok')
    await sendBg({ type: 'report', kind: 'sent', last: { level: 'SUCCESS', message: `Готово (без письма): ${savePayload.vacancy_title}` } })
    return { ok: true, submitted: true, no_letter: true }
  }

  // ─── Variant 1 & 2: form textarea / chat with letter ─────────────────────

  async function handleFormWithLetter(ta, letter, apiBase, token, savePayload, autoSubmit) {
    const hasLetter = !!String(letter || '').trim()
    if (hasLetter) {
      ta.focus()
      setNativeValue(ta, letter)
      await postExtensionLog(apiBase, token, 'INFO', 'Текст письма вставлен в форму (вариант 1)', 'apply_form_letter_set')
    } else {
      await postExtensionLog(apiBase, token, 'INFO', 'Режим без письма: отправка формы без текста', 'apply_form_letter_skip_none')
    }

    if (!autoSubmit) {
      await postExtensionLog(apiBase, token, 'INFO', 'Полуавто: запись черновика из формы (save-application)', 'apply_semi_form_save')
      let sa = null
      try {
        sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      } catch { sa = null }
      if (sa && sa.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: false, error: 'duplicate' }
      }
      await sendBg({
        type: 'report',
        kind: 'sent',
        last: { level: 'INFO', message: `Черновик: ${savePayload.vacancy_title} (нажмите «Отправить» на hh.ru)` },
      })
      return { ok: true, submitted: false }
    }

    const sub = await waitUntil(() => findSubmitButton(), 18000, 160)
    if (!sub) {
      await postExtensionLog(apiBase, token, 'WARNING', 'Кнопка отправки не найдена (форма)', 'apply_form_submit_missing')
      try {
        await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'error', error_message: 'submit_button_missing' })
      } catch { /* */ }
      try {
        await extensionApi('/extension/blacklist-vacancy', 'POST', { vacancy_id: savePayload.vacancy_id, reason: 'submit_btn_missing' })
      } catch { /* */ }
      await sendBg({
        type: 'report',
        kind: 'error',
        last: { level: 'WARNING', message: 'Не найдена кнопка отправки отклика по разметке страницы (DOM).' },
      })
      return { ok: true, submitted: false, error: 'submit_button_missing' }
    }

    await postExtensionLog(
      apiBase,
      token,
      'INFO',
      hasLetter ? 'Клик по отправке (форма с письмом)' : 'Клик по отправке (форма без письма)',
      hasLetter ? 'apply_form_submit_click' : 'apply_form_submit_click_no_letter',
    )
    sub.click()
    await sleep(260)

    for (let j = 0; j < 20; j += 1) {
      if (tryDismissCountryMismatchModal()) {
        await postExtensionLog(apiBase, token, 'INFO', 'После отправки формы: закрыто предупреждение о стране', 'apply_country_modal_after_submit')
        await sleep(220)
      } else break
    }

    if (detectCaptcha()) {
      await waitCaptchaPause(apiBase, token, 'apply_form_captcha_pause')
    }

    const success = await waitApplySuccess(10000)
    if (!success) {
      await postExtensionLog(
        apiBase, token, 'WARNING',
        'Успех формы не подтверждён по разметке страницы (DOM)',
        'apply_form_success_timeout',
      )
      let sae = null
      try {
        sae = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'error', error_message: 'submit_not_confirmed' })
      } catch { sae = null }
      if (sae && sae.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: false, error: 'duplicate' }
      }
      await sendBg({ type: 'report', kind: 'error', last: { level: 'WARNING', message: 'Не подтверждена отправка (проверьте на hh.ru).' } })
      return { ok: true, submitted: false, error: 'submit_not_confirmed' }
    }

    try {
      const sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      if (sa.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: true, error: 'duplicate' }
      }
      if (sa.status === 429) {
        await sendBg({ type: 'report', kind: 'error', stop_loop: true, last: { level: 'WARNING', message: 'Лимит откликов (UTC) — цикл остановлен.' } })
        return { ok: true, submitted: true, error: 'server_limit' }
      }
    } catch { /* */ }

    await postExtensionLog(apiBase, token, 'SUCCESS', `Форма: отклик подтверждён: ${savePayload.vacancy_title.slice(0, 80)}`, 'apply_form_ok')
    await sendBg({ type: 'report', kind: 'sent', last: { level: 'SUCCESS', message: `Готово: ${savePayload.vacancy_title}` } })
    return { ok: true, submitted: true }
  }

  // ─── Main apply flow ──────────────────────────────────────────────────────

  async function runApplyFlow(options) {
    const autoSubmit = !!(options && options.autoSubmit)
    const apiBaseRaw = (await chrome.storage.local.get('hhunter_api_base')).hhunter_api_base || 'http://localhost:8000'
    const apiBase = String(apiBaseRaw).trim().replace(/\/$/, '')
    let token = normalizeToken((await chrome.storage.local.get('hhunter_token')).hhunter_token || '')

    if (detectCaptcha()) {
      await postExtensionLog(apiBase, token, 'WARNING', 'Обнаружена капча до старта сценария', 'apply_captcha')
      await waitCaptchaPause(apiBase, token, 'apply_captcha_before_start_pause')
    }
    if (pageKind() !== 'vacancy') {
      await postExtensionLog(
        apiBase, token, 'WARNING',
        'Страница не вакансия (ожидается путь /vacancy/{id})',
        'apply_not_vacancy',
      )
      await sendBg({ type: 'report', last: { level: 'INFO', message: 'Нужна страница вакансии hh.ru/vacancy/{id}' } })
      return { ok: false, error: 'not_vacancy' }
    }

    const payload = collectVacancyFromPage()
    if (!payload.vacancy_title || !payload.vacancy_description) {
      await postExtensionLog(
        apiBase, token, 'WARNING',
        `Разметка страницы неполная (DOM), id=${payload.vacancy_id}`,
        'apply_parse_dom',
      )
      await sendBg({
        type: 'report',
        kind: 'skipped',
        last: { level: 'WARNING', message: 'Не удалось считать вакансию по разметке страницы (DOM)' },
      })
      return { ok: false, error: 'parse_dom' }
    }

    if (!token) {
      await sendBg({
        type: 'report',
        kind: 'error',
        last: { level: 'ERROR', message: 'Нет токена (JWT). Откройте сайт HHunter, нажмите «Токен с сайта».' },
      })
      return { ok: false, error: 'no_token' }
    }

    await postExtensionLog(
      apiBase, token, 'INFO',
      `Старт отклика: автоотправка (autoSubmit)=${autoSubmit}, вакансия id=${payload.vacancy_id} · ${payload.vacancy_title.slice(0, 100)}`,
      'apply_start',
    )

    // ── Режим письма (чтобы в режиме none не дергать генерацию вообще) ────
    let coverMode = 'ai'
    try {
      // Важно: принудительно обновляем настройки, иначе из-за TTL фона режим может залипнуть на старом значении.
      const st = await sendBg({ type: 'get_state', refresh_settings: true })
      coverMode = String(st?.ext?.cover_letter_mode || 'ai').trim().toLowerCase() || 'ai'
    } catch { /* */ }
    const noLetterMode = coverMode === 'none'

    // ── Контакты (в none-режиме пропускаем/сильно ускоряем) ───────────────
    if (!noLetterMode) {
      const contactInfo = await tryCollectVacancyContact(10000, apiBase, token)
      payload.contact_phone = contactInfo.contact_phone || ''
      payload.contact_name = contactInfo.contact_name || ''
      if (payload.contact_phone) {
        await postExtensionLog(apiBase, token, 'INFO', `Телефон из «Связаться»: ${payload.contact_phone.slice(0, 40)}`, 'apply_contact_ok')
      } else if (contactInfo.reason_code) {
        await postExtensionLog(apiBase, token, 'INFO', `Контакты: ${contactInfo.reason_code}`, `apply_contact_${contactInfo.reason_code}`)
      }
    } else {
      payload.contact_phone = ''
      payload.contact_name = ''
      await postExtensionLog(apiBase, token, 'INFO', 'Режим без письма: сбор контактов пропущен (ускорение)', 'apply_contact_skipped_none')
    }

    // ── Генерация письма ─────────────────────────────────────────────────
    let letter = ''
    let modelUsed = null
    if (!noLetterMode) {
      let res
      try {
        res = await extensionApi('/extension/generate-letter', 'POST', {
          vacancy_title: payload.vacancy_title,
          vacancy_description: payload.vacancy_description,
          company_name: payload.company_name,
          vacancy_requirements: payload.vacancy_requirements || '',
          key_skills: payload.key_skills || '',
          salary_info: payload.salary_info || '',
        })
      } catch (e) {
        const detail = String((e && e.message) || e) || 'Failed to fetch'
        const ru = ruGenerateLetterLogDetail(detail)
        await postExtensionLog(apiBase, token, 'ERROR', `Генерация письма: ${ru}`, 'apply_generate_fail')
        await sendBg({ type: 'report', kind: 'error', stop_loop: false, last: { level: 'ERROR', message: `Генерация письма: ${ru}` } })
        return { ok: false, error: detail }
      }

      const data = res.data && typeof res.data === 'object' ? res.data : {}
      if (!res.ok) {
        // Нерелевантная вакансия — мягкий пропуск без расхода токенов и без ошибки
        if (res.status === 422 && data && data.detail && data.detail.code === 'low_score') {
          const sc = data.detail.score
          await postExtensionLog(
            apiBase,
            token,
            'INFO',
            `Пропуск: вакансия нерелевантна (score=${sc}, min=3)`,
            'apply_low_score_skip',
          )
          try {
            await extensionApi('/extension/save-application', 'POST', {
              vacancy_id: payload.vacancy_id || payload.vacancy_url,
              vacancy_title: payload.vacancy_title,
              vacancy_url: payload.vacancy_url,
              company_name: payload.company_name || null,
              status: 'skipped',
              skip_reason: 'low_score',
              error_message: null,
            })
          } catch { /* */ }
          await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Пропущено (нерелевантно): ${payload.vacancy_title}` } })
          return { ok: true, submitted: false, error: 'low_score', skipped: true }
        }
        const detail = data?.detail || `HTTP ${res.status}`
        let extra = ''
        if (res.status === 429) extra = ' (лимит откликов на сервере)'
        const ru = ruGenerateLetterLogDetail(detail)
        await postExtensionLog(apiBase, token, 'ERROR', `Генерация письма: ${ru}${extra}`, 'apply_generate_fail')
        await sendBg({
          type: 'report',
          kind: 'error',
          stop_loop: res.status === 429,
          last: { level: 'ERROR', message: `Генерация письма: ${ru}${extra}` },
        })
        return { ok: false, error: String(detail) }
      }

      await postExtensionLog(apiBase, token, 'INFO', `Письмо сгенерировано, длина ${(data.letter || '').length}`, 'apply_generate_ok')
      letter = (data.letter || '').trim()
      modelUsed = data.model_used || null
    } else {
      await postExtensionLog(apiBase, token, 'INFO', 'Режим без письма: генерация пропущена (без запроса к LLM)', 'apply_generate_skipped_none')
    }

    const savePayload = {
      vacancy_id: payload.vacancy_id || payload.vacancy_url,
      vacancy_title: payload.vacancy_title,
      vacancy_url: payload.vacancy_url,
      company_name: payload.company_name || null,
      contact_name: payload.contact_name || null,
      contact_phone: payload.contact_phone || null,
      salary_from: payload.salary_from != null ? payload.salary_from : null,
      salary_to: payload.salary_to != null ? payload.salary_to : null,
      salary_currency: payload.salary_currency || null,
      cover_letter: letter,
      model_used: modelUsed,
    }

    // ── Открываем форму отклика ──────────────────────────────────────────
    // Сначала проверяем текущее состояние до клика
    let ui = detectApplyUiState()
    await postExtensionLog(apiBase, token, 'INFO', `Состояние до открытия формы (режим): ${ui}`, 'apply_pre_open_state')

    if (ui === 'none') {
      // Ищем и кликаем кнопку открытия формы
      const openBtn =
        document.querySelector('[data-qa="vacancy-response-link-top"]') ||
        document.querySelector('[data-qa="vacancy-response-button-top"]') ||
        document.querySelector('[data-qa="vacancy-response-link"]') ||
        document.querySelector('[data-qa="vacancy-sidebar-response-link"]') ||
        document.querySelector('a[data-qa*="vacancy-response"][href*="negotiation"]') ||
        document.querySelector('button[data-qa*="vacancy-response"]')

      if (openBtn) {
        openBtn.click()
        await postExtensionLog(apiBase, token, 'INFO', 'Клик по кнопке открытия формы отклика', 'apply_open_form_click')
        await sleep(320)
      } else {
        await postExtensionLog(apiBase, token, 'WARNING', 'Кнопка открытия формы не найдена', 'apply_open_form_missing')
      }
      ui = await waitForApplyUiState(noLetterMode ? 6500 : 22000, 170)
    }

    await postExtensionLog(apiBase, token, 'INFO', `Состояние интерфейса (режим): ${ui}`, 'apply_ui_state')

    // ════════════════════════════════════════════════════════════════════
    // ВАРИАНТ 2: Чат сразу после открытия (вместо формы)
    // ════════════════════════════════════════════════════════════════════
    if (ui === 'chat') {
      await postExtensionLog(apiBase, token, 'INFO', 'Вариант 2: чат-поле видно сразу', 'apply_variant2')
      if (noLetterMode) {
        await postExtensionLog(apiBase, token, 'WARNING', 'Режим без письма: чат требует сообщение — пропуск вакансии', 'apply_none_chat_skip')
        try {
          await extensionApi('/extension/save-application', 'POST', {
            vacancy_id: payload.vacancy_id || payload.vacancy_url,
            vacancy_title: payload.vacancy_title,
            vacancy_url: payload.vacancy_url,
            company_name: payload.company_name || null,
            status: 'skipped',
            skip_reason: 'no_letter_chat',
            error_message: null,
          })
        } catch { /* */ }
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Пропущено (без письма нельзя в чат): ${payload.vacancy_title}` } })
        return { ok: true, submitted: false, error: 'no_letter_chat', skipped: true, via_chat: true }
      }
      if (!autoSubmit) {
        const r = await pasteChatComposerSemiOnly(letter, apiBase, token, savePayload, 24000)
        if (r) return r
      } else {
        const r = await finishIfChatComposerReady(letter, apiBase, token, savePayload, 24000)
        if (r) return r
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // ВАРИАНТ 3: Предупреждение о другой стране
    // ════════════════════════════════════════════════════════════════════
    if (ui === 'warning') {
      await postExtensionLog(apiBase, token, 'INFO', 'Вариант 3: предупреждение о стране', 'apply_variant3')

      // Сначала пробуем чат-путь (кнопка «Написать в чат» / «Чат с работодателем»)
      const chatResult = await handleCountryWarningChatPath(letter, apiBase, token, savePayload, autoSubmit)
      if (chatResult.tried) {
        if (chatResult.ok) return chatResult
        await postExtensionLog(
          apiBase, token, 'WARNING',
          `Чат-путь не сработал: ${chatResult.error || 'неизвестно'}`,
          'apply_warning_chat_failed',
        )
      }

      // Fallback: нажимаем «Всё равно откликнуться» и ждём форму
      await postExtensionLog(apiBase, token, 'INFO', 'Вариант 3 fallback: нажимаем «всё равно откликнуться»', 'apply_warning_dismiss')
      tryDismissCountryMismatchModal()
      await sleep(800)
      ui = await waitForApplyUiState(20000, 200)
      await postExtensionLog(apiBase, token, 'INFO', `После снятия предупреждения: ${ui}`, 'apply_warning_after_dismiss')
    }

    // После снятия предупреждения о стране мог появиться чат (вариант 2 после 3)
    if (ui === 'chat') {
      await postExtensionLog(apiBase, token, 'INFO', 'Чат после предупреждения о стране', 'apply_post_warning_chat')
      if (!autoSubmit) {
        const r = await pasteChatComposerSemiOnly(letter, apiBase, token, savePayload, 20000)
        if (r) return r
      } else {
        const r = await finishIfChatComposerReady(letter, apiBase, token, savePayload, 20000)
        if (r) return r
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // ВАРИАНТ 4: Отклик без поля письма
    // ════════════════════════════════════════════════════════════════════
    if (ui === 'simple') {
      return handleSimpleApply(apiBase, token, savePayload, autoSubmit)
    }

    // Режим без письма: НЕ трогаем toggle письма и НЕ ждём textarea.
    // Если форма отклика открыта (или должна быть открыта после openBtn) — жмём submit напрямую.
    if (noLetterMode) {
      return handleNoLetterForm(apiBase, token, savePayload, autoSubmit)
    }

    // ════════════════════════════════════════════════════════════════════
    // ВАРИАНТ 1: Обычная форма с textarea для письма
    // ════════════════════════════════════════════════════════════════════

    // Ждём textarea (с попутным снятием возможных новых предупреждений)
    let ta = await ensureLetterTextareaVisible()
    if (!ta) {
      let taWait = null
      const t0ta = Date.now()
      while (Date.now() - t0ta < 18000) {
        tryDismissCountryMismatchModal()
        taWait = await ensureLetterTextareaVisible()
        if (taWait && visibleElement(taWait)) break
        await sleep(160)
      }
      ta = taWait
    }

    if (ta && visibleElement(ta)) {
      await postExtensionLog(apiBase, token, 'INFO', 'Вариант 1: форма с полем письма (textarea)', 'apply_variant1')
      return handleFormWithLetter(ta, letter, apiBase, token, savePayload, autoSubmit)
    }

    // ── Финальный fallback: ещё раз проверяем текущий ui ───────────────
    const uiFinal = detectApplyUiState()
    await postExtensionLog(apiBase, token, 'INFO', `Финальное состояние интерфейса (режим): ${uiFinal}`, 'apply_final_ui')

    if (uiFinal === 'chat') {
      if (!autoSubmit) {
        const r = await pasteChatComposerSemiOnly(letter, apiBase, token, savePayload, 16000)
        if (r) return r
      } else {
        const r = await finishIfChatComposerReady(letter, apiBase, token, savePayload, 16000)
        if (r) return r
      }
    }

    if (uiFinal === 'simple') {
      return handleSimpleApply(apiBase, token, savePayload, autoSubmit)
    }

    if (uiFinal === 'warning') {
      // Предупреждение появилось снова или осталось — пробуем ещё раз dismiss
      tryDismissCountryMismatchModal()
      await sleep(600)
      const ta2 = await waitUntil(() => findLetterTextarea(), 8000, 160)
      if (ta2 && visibleElement(ta2)) {
        return handleFormWithLetter(ta2, letter, apiBase, token, savePayload, autoSubmit)
      }
    }

    // Совсем ничего не нашли
    await postExtensionLog(
      apiBase, token, 'WARNING',
      'Поле письма (textarea) не появилось, тип интерфейса не определён за время ожидания',
      'apply_textarea_timeout',
    )

    if (!autoSubmit) {
      let sa = null
      try {
        sa = await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'sent' })
      } catch { sa = null }
      if (sa && sa.status === 409) {
        await sendBg({ type: 'report', kind: 'skipped', last: { level: 'INFO', message: `Уже в базе: ${savePayload.vacancy_title}` } })
        return { ok: true, submitted: false, error: 'duplicate' }
      }
      await sendBg({
        type: 'report',
        kind: 'sent',
        last: { level: 'INFO', message: `Черновик (интерфейс не распознан): ${savePayload.vacancy_title}` },
      })
      return { ok: true, submitted: false }
    }

    try {
      await extensionApi('/extension/save-application', 'POST', { ...savePayload, status: 'error', error_message: 'ui_not_detected' })
    } catch { /* */ }
    // Автобан: вакансия стабильно не поддаётся — пропускаем в следующий раз
    try {
      await extensionApi('/extension/blacklist-vacancy', 'POST', { vacancy_id: savePayload.vacancy_id, reason: 'ui_not_detected' })
    } catch { /* */ }
    await sendBg({
      type: 'report',
      kind: 'error',
      last: { level: 'WARNING', message: 'Интерфейс формы не распознан — вакансия добавлена в блэклист.' },
    })
    return { ok: true, submitted: false, error: 'ui_not_detected' }
  }

  // ─── Message listener ─────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'hhunter_run_once') return false
    let done = false
    let watchdog = null
    const keepAliveMs = 20000
    let keepAliveId = null
    function finish(payload) {
      if (done) return
      done = true
      if (watchdog) clearTimeout(watchdog)
      if (keepAliveId) clearInterval(keepAliveId)
      try { sendResponse(payload) } catch { /* */ }
    }
    const autoSubmit = !!msg.autoSubmit
    const channelTimeoutMs = 180000
    watchdog = setTimeout(function () {
      finish({ ok: false, error: 'content_timeout', channel_timeout: true })
    }, channelTimeoutMs)
    keepAliveId = setInterval(function () {
      try {
        chrome.runtime.sendMessage({ type: 'hhunter_keepalive' }, function () { void chrome.runtime.lastError })
      } catch { /* */ }
    }, keepAliveMs)
    runApplyFlow({ autoSubmit })
      .then(function (r) { finish(r) })
      .catch(function (e) { finish({ ok: false, error: String((e && e.message) || e) }) })
    return true
  })
})()