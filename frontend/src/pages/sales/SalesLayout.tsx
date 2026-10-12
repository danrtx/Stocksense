import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { SubNav } from '../../components/ui'

export function SalesLayout() {
  const { can } = useAuth()
  const items = [
    ...(can('sales:import') ? [{ to: '/ventas', label: 'Historial de ventas', end: true }] : []),
    ...(can('integrations:manage') ? [{ to: '/ventas/claves', label: 'Punto de venta (API)' }] : []),
  ]
  return (
    <>
      {items.length > 1 && <SubNav items={items} label="Secciones de ventas" />}
      <Outlet />
    </>
  )
}
