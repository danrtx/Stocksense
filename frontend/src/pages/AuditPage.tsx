import { useEffect, useState } from 'react'
import { api, ApiError, query, type Page } from '../api/client'
import type { AuditItem } from '../api/types'
import { formatDate } from '../lib/format'
import { Alert, PageHeader, Pagination } from '../components/ui'

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Inicio de sesión',
  'auth.logout': 'Cierre de sesión',
  'auth.locked': 'Cuenta bloqueada',
  'user.created': 'Usuario creado',
  'user.updated': 'Usuario editado',
  'user.role_changed': 'Cambio de rol',
  'user.deactivated': 'Usuario desactivado',
  'user.reactivated': 'Usuario reactivado',
  'user.invitation_sent': 'Invitación enviada',
  'user.invitation_accepted': 'Invitación aceptada',
  'product.created': 'Producto creado',
  'product.updated': 'Producto editado',
  'product.deactivated': 'Producto desactivado',
  'product.reactivated': 'Producto reactivado',
  'category.created': 'Categoría creada',
}

function describe(changes: AuditItem['changes']): string {
  if (!changes) return ''
  return Object.entries(changes)
    .map(([key, value]) => {
      if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
        const v = value as { from: unknown; to: unknown }
        return `${key}: ${String(v.from)} → ${String(v.to)}`
      }
      return `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    })
    .join(' · ')
}

export function AuditPage() {
  const [data, setData] = useState<Page<AuditItem> | null>(null)
  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Page<AuditItem>>(`/audit${query({ entityType, page, limit: 30 })}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message))
  }, [entityType, page])

  return (
    <>
      <PageHeader title="Auditoría" subtitle="Quién hizo qué y cuándo. Este registro no se puede editar." />
      {error && <Alert>{error}</Alert>}
      <div className="filters">
        <select aria-label="Filtrar por tipo" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1) }}>
          <option value="">Todo</option>
          <option value="user">Usuarios y sesiones</option>
          <option value="product">Productos</option>
          <option value="category">Categorías</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Quién</th>
              <th>Qué</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td data-label="Fecha">{formatDate(item.createdAt)}</td>
                <td data-label="Quién">{item.actorEmail ?? 'Sistema'}</td>
                <td data-label="Qué">{ACTION_LABELS[item.action] ?? item.action}</td>
                <td data-label="Detalle" className="small">{describe(item.changes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">Aún no hay eventos.</p>}
      </div>
      {data && <Pagination page={data.page} pages={Math.ceil(data.total / data.limit)} onPage={setPage} />}
    </>
  )
}
