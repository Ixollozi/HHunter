import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { setToken } from '../lib/auth'
import { Hint } from '../components/Hint'
import { btnPrimary, field, link } from '../ui/hover'

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const from = useMemo(() => loc.state?.from || '/', [loc.state])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { username, password })
      setToken(data.access_token)
      nav(from, { replace: true })
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'Не удалось войти. Проверьте логин и пароль.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
        Вход
        <Hint title="После успешного входа сервер выдаёт JWT — он сохраняется в браузере и подставляется в запросы к API." />
      </h1>
      <p className="text-slate-400 mt-1" title="Токен хранится в localStorage под служебным ключом; при «Выйти» удаляется.">
        Токен доступа сохраняется локально в браузере (localStorage).
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          className={field}
          placeholder="Логин"
          title="Имя пользователя (username), то же, что при регистрации."
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className={field}
          placeholder="Пароль"
          title="Пароль от вашего аккаунта HHunter."
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err ? <div className="text-sm text-red-400">{err}</div> : null}
        <button
          type="submit"
          disabled={loading}
          title="Отправить логин и пароль на сервер и получить JWT."
          className={`w-full bg-indigo-600 hover:bg-indigo-500 ${btnPrimary}`}
        >
          {loading ? '…' : 'Войти'}
        </button>
      </form>

      <div className="mt-4 text-sm text-slate-400">
        Нет аккаунта?{' '}
        <Link className={link} to="/register" title="Перейти к форме регистрации нового пользователя.">
          Регистрация
        </Link>
      </div>
    </div>
  )
}
