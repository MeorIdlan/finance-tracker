import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth-context';
import RegisterPage from './pages/RegisterPage';
import VerifyOtpPage from './pages/VerifyOtpPage';
import PasskeyPage from './pages/PasskeyPage';
import LoginPage from './pages/LoginPage';
import RecoverPage from './pages/RecoverPage';
import ProtectedRoute from './ProtectedRoute';
import Layout from './Layout';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AccountsPage from './pages/AccountsPage';
import CommitmentsPage from './pages/CommitmentsPage';
import LoansPage from './pages/LoansPage';
import CreditCardsPage from './pages/CreditCardsPage';
import TransactionsPage from './pages/TransactionsPage';
import AgentPage from './pages/AgentPage';
import OAuthConsentPage from './pages/OAuthConsentPage';

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
          <Route path="/oauth-consent" element={<OAuthConsentPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Layout>
                  <DashboardPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <SettingsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/agent"
            element={
              <ProtectedRoute>
                <Layout>
                  <AgentPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/accounts"
            element={
              <ProtectedRoute>
                <Layout>
                  <AccountsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/commitments"
            element={
              <ProtectedRoute>
                <Layout>
                  <CommitmentsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/loans"
            element={
              <ProtectedRoute>
                <Layout>
                  <LoansPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/credit-cards"
            element={
              <ProtectedRoute>
                <Layout>
                  <CreditCardsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute>
                <Layout>
                  <TransactionsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
