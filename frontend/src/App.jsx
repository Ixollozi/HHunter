import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import Login from './pages/Login'
import Register from './pages/Register'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Search = lazy(() => import('./pages/Search'))
const Results = lazy(() => import('./pages/Results'))
const Reports = lazy(() => import('./pages/Reports'))
const Logs = lazy(() => import('./pages/Logs'))
const Extension = lazy(() => import('./pages/Extension'))

function PageFallback() {
  return <div className="text-slate-400 text-sm p-4">Загрузка…</div>
}

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
              <Suspense fallback={<PageFallback />}>
                <Dashboard />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Settings />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="search"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Search />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="results"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Results />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="reports"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Reports />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="logs"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Logs />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="extension"
          element={
            <RequireAuth>
              <Suspense fallback={<PageFallback />}>
                <Extension />
              </Suspense>
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
