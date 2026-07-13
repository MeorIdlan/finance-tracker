import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import RegisterPage from './pages/RegisterPage';
import VerifyOtpPage from './pages/VerifyOtpPage';
import PasskeyPage from './pages/PasskeyPage';
import LoginPage from './pages/LoginPage';
import RecoverPage from './pages/RecoverPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/verify" element={<VerifyOtpPage />} />
          <Route path="/register/passkey" element={<PasskeyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/recover" element={<RecoverPage />} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
          <Route path="/settings" element={<div>settings</div>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
