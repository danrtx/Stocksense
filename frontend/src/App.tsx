import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Permission } from './api/types'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RequireAuth, RequirePermission } from './auth/guards'
import { Layout } from './components/Layout'
import { AccessDenied, ComingSoon } from './pages/AccessDenied'
import { AcceptInvitationPage } from './pages/AcceptInvitationPage'
import { AiSettingsPage } from './pages/AiSettingsPage'
import { AlertsPage } from './pages/AlertsPage'
import { AuditPage } from './pages/AuditPage'
import { DashboardPage } from './pages/DashboardPage'
import { AccuracyPage } from './pages/forecast/AccuracyPage'
import { ForecastLayout } from './pages/forecast/ForecastLayout'
import { ForecastSummaryPage } from './pages/forecast/ForecastSummaryPage'
import { ModelsPage } from './pages/forecast/ModelsPage'
import { CountDetailPage } from './pages/inventory/CountDetailPage'
import { CountsPage } from './pages/inventory/CountsPage'
import { InventoryLayout } from './pages/inventory/InventoryLayout'
import { MovementFormPage } from './pages/inventory/MovementFormPage'
import { MovementsPage } from './pages/inventory/MovementsPage'
import { StockPage } from './pages/inventory/StockPage'
import { TransfersPage } from './pages/inventory/TransfersPage'
import { WarehousesPage } from './pages/inventory/WarehousesPage'
import { LoginPage } from './pages/LoginPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { ProductImportPage } from './pages/ProductImportPage'
import { ProductsPage } from './pages/ProductsPage'
import { OrderDetailPage } from './pages/purchases/OrderDetailPage'
import { OrderFormPage } from './pages/purchases/OrderFormPage'
import { OrdersPage } from './pages/purchases/OrdersPage'
import { PurchasesLayout } from './pages/purchases/PurchasesLayout'
import { SupplierDetailPage } from './pages/purchases/SupplierDetailPage'
import { SuggestionsPage } from './pages/purchases/SuggestionsPage'
import { SuppliersPage } from './pages/purchases/SuppliersPage'
import { ApiKeysPage } from './pages/sales/ApiKeysPage'
import { ModelDataPage } from './pages/sales/ModelDataPage'
import { SalesLayout } from './pages/sales/SalesLayout'
import { SalesPage } from './pages/sales/SalesPage'
import { UsersPage } from './pages/UsersPage'
import { ThemeProvider } from './theme/ThemeContext'

const need = (permission: Permission, element: ReactNode) => <RequirePermission permission={permission}>{element}</RequirePermission>

/** Ruta visible si el rol tiene al menos uno de los permisos. */
function RequireAny({ anyOf, children }: { anyOf: Permission[]; children: ReactNode }) {
  const { can } = useAuth()
  return anyOf.some((p) => can(p)) ? <>{children}</> : <AccessDenied />
}

/** Ventas: quien no carga historial entra directo a las claves del punto de venta. */
function SalesIndex() {
  const { can } = useAuth()
  if (can('sales:import')) return <SalesPage />
  if (can('integrations:manage')) return <Navigate to="/ventas/claves" replace />
  return <Navigate to="/pronostico/datos" replace />
}

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
            <Route path="productos" element={need('products:read', <ProductsPage />)} />
            <Route path="productos/importar" element={need('products:write', <ProductImportPage />)} />
            <Route path="productos/:id" element={need('products:read', <ProductDetailPage />)} />

            <Route path="inventario/registrar" element={need('stock:write', <MovementFormPage />)} />
            <Route path="inventario" element={need('stock:read', <InventoryLayout />)}>
              <Route index element={<StockPage />} />
              <Route path="movimientos" element={<MovementsPage />} />
              <Route path="transferencias" element={<TransfersPage />} />
              <Route path="conteos" element={<CountsPage />} />
              <Route path="conteos/:id" element={<CountDetailPage />} />
              <Route path="bodegas" element={need('warehouses:manage', <WarehousesPage />)} />
            </Route>

            <Route path="compras" element={<RequireAny anyOf={['purchases:read', 'purchases:receive']}><PurchasesLayout /></RequireAny>}>
              <Route index element={<OrdersPage />} />
              <Route path="ordenes/nueva" element={need('purchases:write', <OrderFormPage />)} />
              <Route path="ordenes/:id" element={<OrderDetailPage />} />
              <Route path="ordenes/:id/editar" element={need('purchases:write', <OrderFormPage />)} />
              <Route path="sugerencias" element={need('forecast:read', need('purchases:read', <SuggestionsPage />))} />
              <Route path="proveedores" element={need('purchases:read', <SuppliersPage />)} />
              <Route path="proveedores/:id" element={need('purchases:read', <SupplierDetailPage />)} />
            </Route>

            <Route path="ventas" element={<RequireAny anyOf={['sales:import', 'forecast:read', 'integrations:manage']}><SalesLayout /></RequireAny>}>
              <Route index element={<SalesIndex />} />
              {/* Antes del sprint 6 los datos del modelo vivían en Ventas. */}
              <Route path="modelo" element={<Navigate to="/pronostico/datos" replace />} />
              <Route path="claves" element={need('integrations:manage', <ApiKeysPage />)} />
            </Route>

            <Route path="pronostico" element={need('forecast:read', <ForecastLayout />)}>
              <Route index element={<ForecastSummaryPage />} />
              <Route path="precision" element={<AccuracyPage />} />
              <Route path="modelos" element={<ModelsPage />} />
              <Route path="datos" element={<ModelDataPage />} />
            </Route>

            <Route path="alertas" element={need('alerts:read', <AlertsPage />)} />
            <Route path="usuarios" element={need('users:manage', <UsersPage />)} />
            <Route path="auditoria" element={need('audit:read', <AuditPage />)} />
            <Route path="configuracion/ia" element={need('ai:manage', <AiSettingsPage />)} />
            <Route path="reportes" element={need('reports:read', <ComingSoon title="Reportes" sprint="sprint 9" />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}
