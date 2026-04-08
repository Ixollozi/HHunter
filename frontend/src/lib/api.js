import axios from 'axios'
import { getToken } from './auth'

export const apiBaseUrl = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

/** WebSocket origin (ws/wss) для того же хоста, что и REST. */
export function wsBaseUrl() {
  try {
    const u = new URL(apiBaseUrl)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${u.protocol}//${u.host}`
  } catch {
    return 'ws://localhost:8000'
  }
}

export const api = axios.create({
  baseURL: apiBaseUrl,
})

api.interceptors.request.use((config) => {
  const t = getToken()
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

