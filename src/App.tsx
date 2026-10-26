import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router'
import { useAuth } from './auth'
import Login from './pages/Login'

const Home = lazy(() => import('./pages/client/Home'))
const Profile = lazy(() => import('./pages/client/Profile'))
const ApplicationPage = lazy(() => import('./pages/client/ApplicationPage'))
const Apply = lazy(() => import('./pages/client/Apply'))
const Queue = lazy(() => import('./pages/bank/Queue'))
const Dossier = lazy(() => import('./pages/bank/Dossier'))

function StartupLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-[#EF3124] text-xl font-black text-white shadow-lg">
          A
        </div>
        <div>
          <p className="font-semibold text-neutral-900">Умный кредитный кабинет</p>
          <p className="mt-1 text-sm text-muted-foreground">Команда «Сурки» · Проверяем сессию…</p>
        </div>
      </div>
    </div>
  )
}

function RouteFocus() {
  const location = useLocation()

  useEffect(() => {
    const focusMain = () => {
      const main = document.getElementById('main-content')
      if (!main) return false
      main.focus({ preventScroll: true })
      return true
    }
    if (focusMain()) return
    const observer = new MutationObserver(() => { if (focusMain()) observer.disconnect() })
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => observer.disconnect(), 1500)
    return () => { observer.disconnect(); window.clearTimeout(timeout) }
  }, [location.pathname])

  return null
}

function Guard({ role, children }: { role: 'CLIENT' | 'BANK'; children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <StartupLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={user.role === 'BANK' ? '/bank' : '/dashboard'} replace />
  return <>{children}</>
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <>
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-4 py-2 font-medium text-neutral-950 shadow-lg focus:not-sr-only">Перейти к основному содержанию</a>
      <RouteFocus />
      <Suspense fallback={<StartupLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            loading ? <StartupLoader /> :
            <Navigate to={!user ? '/login' : user.role === 'BANK' ? '/bank' : '/dashboard'} replace />
          } />
          <Route path="/dashboard" element={<Guard role="CLIENT"><Home /></Guard>} />
          <Route path="/profile" element={<Guard role="CLIENT"><Profile /></Guard>} />
          <Route path="/apply/:id" element={<Guard role="CLIENT"><Apply /></Guard>} />
          <Route path="/applications/:id" element={<Guard role="CLIENT"><ApplicationPage /></Guard>} />
          <Route path="/bank" element={<Guard role="BANK"><Queue /></Guard>} />
          <Route path="/bank/applications/:id" element={<Guard role="BANK"><Dossier /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
