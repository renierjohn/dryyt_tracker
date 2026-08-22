import { Routes, Route } from 'react-router-dom'
import './App.css'

function Placeholder({ name }: { name: string }) {
  return <div>{name} page — implemented in the next task</div>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder name="Home" />} />
      <Route path="/login" element={<Placeholder name="Login" />} />
      <Route path="/register" element={<Placeholder name="Register" />} />
      <Route path="/forgot-password" element={<Placeholder name="Forgot password" />} />
      <Route path="/reset-password" element={<Placeholder name="Reset password" />} />
    </Routes>
  )
}

export default App
