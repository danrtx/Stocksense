import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, query, type Page } from '../../api/client'
import type { Supplier } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, FieldError, Modal, PageHeader, Pagination } from '../../components/ui'

/** HU-10 · T-10.2: listado y búsqueda de proveedores. */
export function SuppliersPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<Page<Supplier> | null>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState('true')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Page<Supplier>>(`/suppliers${query({ q, active, page, limit: 20 })}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [q, active, page])
  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <PageHeader
        title="Proveedores"
        subtitle="A quién le compras y en cuántos días entrega"
        actions={can('purchases:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuevo proveedor</button>}
      />
      {error && <Alert>{error}</Alert>}
      <div className="filters">
        <input type="search" aria-label="Buscar proveedor" placeholder="Buscar por nombre, correo o NIT" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        <select aria-label="Estado" value={active} onChange={(e) => { setActive(e.target.value); setPage(1) }}>
          <option value="true">Activos</option>
          <option value="false">Desactivados</option>
          <option value="all">Todos</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Contacto</th>
              <th className="num">Días de entrega</th>
              <th className="num">Real promedio</th>
              <th className="num">Productos</th>
              <th className="num">Órdenes abiertas</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id} className={s.isActive ? '' : 'is-inactive'}>
                <td data-label="Proveedor">
                  <Link to={`/compras/proveedores/${s.id}`} className="row-link"><strong>{s.name}</strong></Link>
                  {!s.isActive && <span className="tag">Desactivado</span>}
                  {s.taxId && <span className="cell-note">NIT {s.taxId}</span>}
                </td>
                <td data-label="Contacto">{s.contactName ?? '—'}{s.email && <span className="cell-note">{s.email}</span>}</td>
                <td data-label="Días de entrega" className="num">{s.leadTimeDays}</td>
                <td data-label="Real promedio" className="num">{s.actualLeadTimeDays ?? '—'}</td>
                <td data-label="Productos" className="num">{s.productCount}</td>
                <td data-label="Órdenes abiertas" className="num">{s.openOrders}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">{q ? `No encontramos proveedores para "${q}".` : 'Todavía no hay proveedores.'}</p>}
      </div>
      {data && <Pagination page={data.page} pages={data.pages ?? 1} onPage={setPage} />}
      {creating && <SupplierForm supplier={null} onClose={() => setCreating(false)} onSaved={(s) => navigate(`/compras/proveedores/${s.id}`)} />}
    </>
  )
}

export function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    taxId: supplier?.taxId ?? '',
    contactName: supplier?.contactName ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    leadTimeDays: supplier ? String(supplier.leadTimeDays) : '',
    notes: supplier?.notes ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (form.name.trim().length < 2) next.name = 'Escribe el nombre (mínimo 2 caracteres).'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Escribe un correo válido.'
    const days = Number(form.leadTimeDays)
    if (form.leadTimeDays === '' || !Number.isInteger(days) || days < 0 || days > 365) next.leadTimeDays = 'Días enteros entre 0 y 365.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const body = { ...form, leadTimeDays: days }
      onSaved(supplier
        ? await api<Supplier>(`/suppliers/${supplier.id}`, { method: 'PATCH', json: body })
        : await api<Supplier>('/suppliers', { method: 'POST', json: body }))
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr.status === 409) setErrors({ name: apiErr.message })
      else setServerError(apiErr.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={supplier ? `Editar ${supplier.name}` : 'Nuevo proveedor'} onClose={onClose}>
      {serverError && <Alert>{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="form-grid">
        <div className="span-2">
          <label htmlFor="sp-name">Nombre o razón social</label>
          <input id="sp-name" value={form.name} onChange={set('name')} aria-invalid={!!errors.name} aria-describedby="sp-name-err" />
          <FieldError id="sp-name-err" message={errors.name} />
        </div>
        <div>
          <label htmlFor="sp-tax">NIT (opcional)</label>
          <input id="sp-tax" value={form.taxId} onChange={set('taxId')} maxLength={30} />
        </div>
        <div>
          <label htmlFor="sp-days">Días de entrega</label>
          <input id="sp-days" inputMode="numeric" value={form.leadTimeDays} onChange={set('leadTimeDays')} aria-invalid={!!errors.leadTimeDays} aria-describedby="sp-days-err" />
          <FieldError id="sp-days-err" message={errors.leadTimeDays} />
        </div>
        <div>
          <label htmlFor="sp-contact">Contacto</label>
          <input id="sp-contact" value={form.contactName} onChange={set('contactName')} maxLength={120} />
        </div>
        <div>
          <label htmlFor="sp-phone">Teléfono</label>
          <input id="sp-phone" type="tel" value={form.phone} onChange={set('phone')} maxLength={40} />
        </div>
        <div className="span-2">
          <label htmlFor="sp-email">Correo</label>
          <input id="sp-email" type="email" value={form.email} onChange={set('email')} aria-invalid={!!errors.email} aria-describedby="sp-email-err" />
          <FieldError id="sp-email-err" message={errors.email} />
        </div>
        <div className="span-2">
          <label htmlFor="sp-notes">Notas (opcional)</label>
          <textarea id="sp-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </div>
        <div className="modal-actions span-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  )
}
