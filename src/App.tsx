import { Navigate, Routes, Route } from 'react-router-dom'
import { useCurrentUser } from './lib/useCurrentUser'
import { hasManageUsers, hasPermission } from './lib/permissions'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import UserPage from './pages/UserPage'
import AdminConsole from './pages/AdminConsole'
import MasqueradeBanner from './components/MasqueradeBanner'
import { pluginRoutes } from './plugins/loadPlugins'
import './assets/sass/app.scss'

function App() {
  const { user, masquerade, loading, refresh } = useCurrentUser()

  if (loading) return <p>Loading…</p>

  return (
    <>
      {user && masquerade && <MasqueradeBanner user={user} masquerade={masquerade} refresh={refresh} />}
      <Routes>
        <Route
          path="/"
          element={
            !user ? <Navigate to="/login" replace />
            : hasManageUsers(user) ? <Home user={user} refresh={refresh} />
            : <Navigate to="/dashboard" replace />
          }
        />
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <Login onLoggedIn={refresh} />}
        />
        <Route
          path="/register"
          element={user ? <Navigate to="/" replace /> : <Register onRegistered={refresh} />}
        />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/users/:id" element={<UserPage />} />
        <Route
          path="/dashboard"
          element={
            !user ? <Navigate to="/login" replace />
            : hasManageUsers(user) ? <Navigate to="/admin" replace />
            : <Dashboard user={user} refresh={refresh} />
          }
        />
        <Route
          path="/admin"
          element={
            !user ? <Navigate to="/login" replace />
            : hasManageUsers(user) ? <AdminConsole user={user} refresh={refresh} />
            : <Navigate to="/dashboard" replace />
          }
        />
        {pluginRoutes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              !user ? <Navigate to="/login" replace />
              : route.requiredPermission && !hasPermission(user, route.requiredPermission)
                ? <Navigate to="/" replace />
                : route.element
            }
          />
        ))}
      </Routes>
    </>
  )
}

export default App
