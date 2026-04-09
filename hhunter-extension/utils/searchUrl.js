/**
 * Сборка URL выдачи {origin}/search/vacancy из объекта search с бэкенда
 * (см. search_config_dict_from_row). baseOrigin — региональный сайт (например https://tashkent.hh.uz).
 */
function buildSearchUrl(search, baseOrigin) {
  const origin = String(baseOrigin || 'https://hh.ru')
    .trim()
    .replace(/\/$/, '')
  const s = search || {}
  const u = new URLSearchParams()
  const text = String(s.search_text || '').trim()
  if (text) u.set('text', text)
  if (s.area != null && String(s.area).trim()) u.set('area', String(s.area).trim())
  if (s.experience != null && String(s.experience).trim()) u.set('experience', String(s.experience).trim())
  if (Array.isArray(s.employment)) {
    s.employment.forEach(function (e) {
      if (e) u.append('employment', String(e))
    })
  } else if (s.employment) u.set('employment', String(s.employment))
  if (Array.isArray(s.schedule)) {
    s.schedule.forEach(function (sch) {
      if (sch) u.append('schedule', String(sch))
    })
  } else if (s.schedule) u.set('schedule', String(s.schedule))
  if (s.period != null && s.period !== '') {
    const p = parseInt(String(s.period), 10)
    if (!isNaN(p)) u.set('period', String(p))
  }
  if (s.salary != null && s.salary !== '') {
    u.set('salary', String(s.salary))
    u.set('currency', 'RUR')
  }
  if (s.only_with_salary) u.set('only_with_salary', 'true')
  if (s.order_by != null && String(s.order_by).trim()) u.set('order_by', String(s.order_by).trim())
  if (Array.isArray(s.search_fields)) {
    s.search_fields.forEach(function (f) {
      if (f) u.append('search_field', String(f))
    })
  }
  // Веб-выдача hh.ru: параметр items_on_page (аналог per_page в ТЗ), не путать с API.
  let ipp = parseInt(String(s.items_on_page != null ? s.items_on_page : s.per_page != null ? s.per_page : ''), 10)
  if (isNaN(ipp) || ipp < 1) ipp = 100
  ipp = Math.min(ipp, 100)
  u.set('items_on_page', String(ipp))
  u.set('hhtmFrom', 'vacancy_search_list')
  return origin + '/search/vacancy?' + u.toString()
}
