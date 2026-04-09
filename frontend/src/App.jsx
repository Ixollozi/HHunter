import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Register from './pages/Register'
import Extension from './pages/Extension'
import Logs from './pages/Logs'
import Reports from './pages/Reports'
import Results from './pages/Results'
import Search from './pages/Search'
import Settings from './pages/Settings'

function App() {
  return (
    <Routes>
      {/* Явный path="/" — надёжнее для React Router 7, чем layout без path */}
      <Route path="/" element={<Layout />}>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route
          index
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
        <Route
          path="search"
          element={
            <RequireAuth>
              <Search />
            </RequireAuth>
          }
        />
        <Route
          path="results"
          element={
            <RequireAuth>
              <Results />
            </RequireAuth>
          }
        />
        <Route
          path="reports"
          element={
            <RequireAuth>
              <Reports />
            </RequireAuth>
          }
        />
        <Route
          path="logs"
          element={
            <RequireAuth>
              <Logs />
            </RequireAuth>
          }
        />
        <Route
          path="extension"
          element={
            <RequireAuth>
              <Extension />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
