import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { setToken } from '../lib/auth'
import { Hint } from '../components/Hint'
import { btnPrimary, field, link } from '../ui/hover'

export default function Register() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/register', { username, password })
      setToken(data.access_token)
      nav('/', { replace: true })
    } catch (e2) {
      const d = e2?.response?.data?.detail
      setErr(Array.isArray(d) ? d.map((x) => x.msg || x).join('; ') : d || 'Ошибка регистрации')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
        Регистрация
        <Hint title="Создаётся запись в БД и пустой профиль настроек; сразу выдаётся токен — отдельно входить не нужно." />
      </h1>
      <p
        className="text-slate-400 mt-1"
        title="Это учётная запись только для HHunter."
      >
        Логин и пароль для доступа к этой платформе (не то же самое, что логин на hh.ru).
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          className={field}
          placeholder="Логин (3–64 символа: буквы, цифры, . _ -)"
          title="Уникальное имя без пробелов. Разрешены латинские буквы, цифры, точка, подчёркивание и дефис."
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className={field}
          placeholder="Пароль (не короче 6 символов)"
          title="Хранится на сервере только в виде хэша. Рекомендуется сложный пароль."
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err ? <div className="text-sm text-red-400">{err}</div> : null}
        <button
          type="submit"
          disabled={loading}
          title="Создать пользователя и сразу открыть главную страницу с токеном."
          className={`w-full bg-indigo-600 hover:bg-indigo-500 ${btnPrimary}`}
        >
          {loading ? '…' : 'Создать аккаунт'}
        </button>
      </form>

      <div className="mt-4 text-sm text-slate-400">
        Уже есть аккаунт?{' '}
        <Link className={link} to="/login" title="Перейти к форме входа.">
          Войти
        </Link>
      </div>
    </div>
  )
}
