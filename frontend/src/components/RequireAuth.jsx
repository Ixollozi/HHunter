import { Navigate, useLocation } from 'react-router-dom'
import { isAuthed } from '../lib/auth'

export function RequireAuth({ children }) {
  const loc = useLocation()
  if (!isAuthed()) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return children
}

