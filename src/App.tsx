import { Navigate, Routes, Route } from 'react-router-dom'
import { useCurrentUser } from './lib/useCurrentUser'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import UserPage from './pages/UserPage'
import AdminConsole from './pages/AdminConsole'
import './App.css'

function App() {
  const { user, loading, refresh } = useCurrentUser()

  if (loading) return <p>Loading…</p>

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <Dashboard user={user} refresh={refresh} /> : <Navigate to="/login" replace />}
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
        path="/admin"
        element={
          user && (user.permissions.includes('*') || user.permissions.includes('manage_users'))
            ? <AdminConsole />
            : <Navigate to="/" replace />
        }
      />
    </Routes>
  )
}

export default App
