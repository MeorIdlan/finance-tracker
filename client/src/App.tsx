import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth-context';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/register" element={<div>register</div>} />
          <Route path="/register/verify" element={<div>verify</div>} />
          <Route path="/register/passkey" element={<div>passkey</div>} />
          <Route path="/login" element={<div>login</div>} />
          <Route path="/recover" element={<div>recover</div>} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
          <Route path="/settings" element={<div>settings</div>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
