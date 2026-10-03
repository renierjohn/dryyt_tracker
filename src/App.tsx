import { Fragment } from 'react'
import { Navigate, Routes, Route } from 'react-router-dom'
import { useCurrentUser } from './lib/useCurrentUser'
import { isSuperadmin, canSendAlerts, hasPermission } from './lib/permissions'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import UserPage from './pages/UserPage'
import Track from './pages/Track'
import AdminConsole from './pages/AdminConsole'
import AdminAlerts from './pages/AdminAlerts'
import MasqueradeBanner from './components/MasqueradeBanner'
import PluginSlot from './components/PluginSlot'
import { pluginRoutes } from './plugins/loadPlugins'
import './assets/sass/app.scss'

function App() {
  const { user, masquerade, loading, refresh } = useCurrentUser()

  if (loading) return <p>Loading…</p>

  return (
    <>
      {/* Root-level extension point: plugins that need to act on every route (not
          just one host page) register a component for this slot — e.g. the theme
          plugin applies the signed-in user's flavor here. */}
      {user && <PluginSlot name="app.root" user={user} />}
      {user && masquerade && <MasqueradeBanner user={user} masquerade={masquerade} refresh={refresh} />}
      <Routes>
        <Route path="/" element={<Home user={user} refresh={refresh} />} />
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
        <Route path="/track" element={<Track />} />
        <Route
          path="/dashboard"
          element={
            !user ? <Navigate to="/login" replace />
            : isSuperadmin(user) ? <Navigate to="/admin" replace />
            : <Dashboard user={user} refresh={refresh} />
          }
        />
        <Route
          path="/admin"
          element={
            !user ? <Navigate to="/login" replace />
            : isSuperadmin(user) ? <AdminConsole user={user} refresh={refresh} />
            : <Navigate to="/dashboard" replace />
          }
        />
        <Route
          path="/admin/alerts"
          element={
            !user ? <Navigate to="/login" replace />
            : canSendAlerts(user) ? <AdminAlerts />
            : <Navigate to="/dashboard" replace />
          }
        />
        {pluginRoutes.map((route) => {
          const element =
            route.public ? route.element
            : !user ? <Navigate to="/login" replace />
            : route.requiredPermission && !hasPermission(user, route.requiredPermission)
              ? <Navigate to="/" replace />
              : route.element
          return (
            <Fragment key={route.path}>
              <Route path={route.path} element={element} />
              {route.alias && <Route path={route.alias} element={element} />}
            </Fragment>
          )
        })}
      </Routes>
    </>
  )
}

export default App
