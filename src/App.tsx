import { Navigate, Routes, Route } from 'react-router-dom'
import { useCurrentUser } from './lib/useCurrentUser'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import AuthedHome from './pages/AuthedHome'
import './App.css'

function App() {
  const { user, loading, refresh } = useCurrentUser()

  if (loading) return <p>Loading…</p>

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <AuthedHome user={user} onLoggedOut={refresh} /> : <Navigate to="/login" replace />}
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
    </Routes>
  )
}

export default App
