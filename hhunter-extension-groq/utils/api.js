export const DEFAULT_API_BASE = 'http://localhost:8000'

export async function apiFetch(apiBase, token, path, init = {}) {
  const url = `${apiBase.replace(/\\/$/, '')}${path}`
  const headers = Object.assign({}, init.headers || {})
  headers['Content-Type'] = headers['Content-Type'] || 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { ...init, headers })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data && data.detail ? data.detail : text || res.statusText
    const err = new Error(String(msg))
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

