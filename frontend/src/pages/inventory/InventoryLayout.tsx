import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { SubNav } from '../../components/ui'

/** Sección Inventario: stock, movimientos, transferencias, conteos y bodegas. */
export function InventoryLayout() {
  const { can } = useAuth()
  const items = [
    { to: '/inventario', label: 'Stock', end: true },
    { to: '/inventario/movimientos', label: 'Movimientos' },
    { to: '/inventario/transferencias', label: 'Transferencias' },
    { to: '/inventario/conteos', label: 'Conteos' },
    ...(can('warehouses:manage') ? [{ to: '/inventario/bodegas', label: 'Bodegas' }] : []),
  ]
  return (
    <>
      <SubNav items={items} label="Secciones de inventario" />
      <Outlet />
    </>
  )
}
