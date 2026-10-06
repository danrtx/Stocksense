import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Page } from '../api/client'
import { ROLE_LABELS, type Product } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../components/ui'

export function DashboardPage() {
  const { user, can } = useAuth()
  const [products, setProducts] = useState<number | null>(null)

  useEffect(() => {
    if (!can('products:read')) return
    api<Page<Product>>('/products?limit=1').then((r) => setProducts(r.total)).catch(() => undefined)
  }, [can])

  return (
    <>
      <PageHeader title={`Hola, ${user?.fullName.split(' ')[0]}`} subtitle={`Entraste como ${ROLE_LABELS[user!.role]}.`} />
      <div className="cards">
        {can('products:read') && (
          <Link to="/productos" className="card card-link">
            <span className="card-label">Productos activos</span>
            <span className="card-value">{products ?? '…'}</span>
            <span className="muted small">Ver catálogo</span>
          </Link>
        )}
        {can('users:manage') && (
          <Link to="/usuarios" className="card card-link">
            <span className="card-label">Equipo</span>
            <span className="card-value">Usuarios</span>
            <span className="muted small">Invitar y asignar roles</span>
          </Link>
        )}
        <div className="card card-muted">
          <span className="card-label">Próximamente</span>
          <span className="card-value">Stock y alertas</span>
          <span className="muted small">Sprints 2 a 5</span>
        </div>
      </div>
    </>
  )
}
