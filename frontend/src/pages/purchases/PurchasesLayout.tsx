import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { SubNav } from '../../components/ui'

export function PurchasesLayout() {
  const { can } = useAuth()
  const items = [
    { to: '/compras', label: 'Órdenes de compra', end: true },
    ...(can('purchases:read') && can('forecast:read') ? [{ to: '/compras/sugerencias', label: 'Sugerencias' }] : []),
    ...(can('purchases:read') ? [{ to: '/compras/proveedores', label: 'Proveedores' }] : []),
  ]
  return (
    <>
      <SubNav items={items} label="Secciones de compras" />
      <Outlet />
    </>
  )
}
