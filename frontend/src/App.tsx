import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ThemeProvider } from './theme/ThemeContext'
import { RequireAuth, RequirePermission } from './auth/guards'
import { Layout } from './components/Layout'
import { ComingSoon } from './pages/AccessDenied'
import { AcceptInvitationPage } from './pages/AcceptInvitationPage'
import { AuditPage } from './pages/AuditPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { ProductsPage } from './pages/ProductsPage'
import { UsersPage } from './pages/UsersPage'

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invitacion/:token" element={<AcceptInvitationPage />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="productos" element={<RequirePermission permission="products:read"><ProductsPage /></RequirePermission>} />
            <Route path="usuarios" element={<RequirePermission permission="users:manage"><UsersPage /></RequirePermission>} />
            <Route path="auditoria" element={<RequirePermission permission="audit:read"><AuditPage /></RequirePermission>} />
            <Route path="compras" element={<RequirePermission permission="purchases:read"><ComingSoon title="Compras" sprint="sprint 4" /></RequirePermission>} />
            <Route path="reportes" element={<RequirePermission permission="reports:read"><ComingSoon title="Reportes" sprint="sprint 9" /></RequirePermission>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}
