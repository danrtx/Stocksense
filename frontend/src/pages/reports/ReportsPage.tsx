import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, downloadFile, query } from '../../api/client'
import { MOVEMENT_LABELS, type Category, type ReportKind, type ReportResult, type Warehouse } from '../../api/types'
import { Icon, type IconName } from '../../components/Icon'
import { Alert, PageHeader } from '../../components/ui'
import { formatCell, NUMERIC_TYPES, todayIso } from '../../lib/format'

interface ReportInfo {
  kind: ReportKind
  title: string
  help: string
  icon: IconName
  filters: ('warehouse' | 'category' | 'period' | 'type' | 'flagged')[]
  /** Días del periodo por defecto (los mismos que usa la API). */
  defaultDays?: number
}

const REPORTS: ReportInfo[] = [
  { kind: 'stock', title: 'Stock valorizado', help: 'Cuánto hay y cuánto vale, por producto y bodega', icon: 'box', filters: ['warehouse', 'category'] },
  { kind: 'movements', title: 'Movimientos', help: 'Entradas, salidas, ajustes y ventas con su saldo', icon: 'swap', filters: ['period', 'type', 'warehouse', 'category'], defaultDays: 30 },
  { kind: 'rotation', title: 'Rotación', help: 'Qué se vende rápido y qué se queda quieto', icon: 'trend', filters: ['period', 'warehouse', 'category'], defaultDays: 365 },
  { kind: 'accuracy', title: 'Precisión del pronóstico', help: 'Qué tanto acierta el modelo por producto', icon: 'chart', filters: ['category', 'flagged'] },
]

const daysAgo = (n: number) => {
  const d = new Date(`${todayIso()}T12:00:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * HU-28: cuatro reportes con filtros, vista previa y descarga en Excel o PDF.
 * Los filtros viven en la dirección: un enlace copiado abre el mismo reporte.
 */
export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const kind = (REPORTS.some((r) => r.kind === params.get('r')) ? params.get('r') : 'stock') as ReportKind
  const info = REPORTS.find((r) => r.kind === kind)!
  const filters = useMemo(
    () => ({
      warehouseId: params.get('bodega') ?? '',
      categoryId: params.get('categoria') ?? '',
      from: params.get('desde') ?? '',
      to: params.get('hasta') ?? '',
      type: params.get('tipo') ?? '',
      onlyFlagged: params.get('revisar') === '1',
    }),
    [params],
  )
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [data, setData] = useState<{ key: string; report: ReportResult } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null)
  const [downloaded, setDownloaded] = useState<string | null>(null)

  useEffect(() => {
    api<Warehouse[]>('/warehouses').then((w) => setWarehouses(w.filter((x) => x.isActive))).catch(() => undefined)
    api<Category[]>('/categories').then(setCategories).catch(() => undefined)
  }, [])

  const qs = query({
    warehouseId: info.filters.includes('warehouse') ? filters.warehouseId : undefined,
    categoryId: info.filters.includes('category') ? filters.categoryId : undefined,
    from: info.filters.includes('period') ? filters.from : undefined,
    to: info.filters.includes('period') ? filters.to : undefined,
    type: info.filters.includes('type') ? filters.type : undefined,
    onlyFlagged: info.filters.includes('flagged') && filters.onlyFlagged ? 'true' : undefined,
  })
  const requestKey = `${kind}${qs}`

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      api<ReportResult>(`/reports/${kind}${qs}`)
        .then((report) => {
          if (cancelled) return
          setData({ key: requestKey, report })
          setError(null)
        })
        .catch((e: ApiError) => !cancelled && setError(e.message))
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [kind, qs, requestKey])

  const loading = !data || data.key !== requestKey
  const report = data?.report

  function set(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
    setDownloaded(null)
  }

  function choose(next: ReportKind) {
    const p = new URLSearchParams(params)
    p.set('r', next)
    for (const k of ['desde', 'hasta', 'tipo', 'revisar']) p.delete(k)
    setParams(p, { replace: true })
    setDownloaded(null)
  }

  async function download(format: 'xlsx' | 'pdf') {
    setDownloading(format)
    setDownloaded(null)
    setError(null)
    try {
      const sep = qs ? '&' : '?'
      const name = await downloadFile(`/reports/${kind}/export${qs}${sep}format=${format}`)
      setDownloaded(name)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setDownloading(null)
    }
  }

  const today = todayIso()
  return (
    <div className="reports">
      <PageHeader title="Reportes" subtitle="Elige un reporte, ajusta los filtros y descárgalo en Excel o PDF. El archivo trae lo mismo que ves aquí." />

      <div className="report-picker" role="radiogroup" aria-label="Reporte">
        {REPORTS.map((r) => (
          <label key={r.kind} className="report-option">
            <input type="radio" className="sr-only" name="report" checked={r.kind === kind} onChange={() => choose(r.kind)} />
            <span className="report-icon" aria-hidden="true"><Icon name={r.icon} size={20} /></span>
            <strong>{r.title}</strong>
            <span className="small muted">{r.help}</span>
          </label>
        ))}
      </div>

      <section className="card report-filters" aria-label="Filtros">
        {info.filters.includes('period') && (
          <>
            <div className="field">
              <label htmlFor="rf-from">Desde</label>
              <input id="rf-from" type="date" max={filters.to || today} value={filters.from || daysAgo((info.defaultDays ?? 30) - 1)} onChange={(e) => set('desde', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rf-to">Hasta</label>
              <input id="rf-to" type="date" max={today} value={filters.to || today} onChange={(e) => set('hasta', e.target.value)} />
            </div>
          </>
        )}
        {info.filters.includes('type') && (
          <div className="field">
            <label htmlFor="rf-type">Tipo</label>
            <select id="rf-type" value={filters.type} onChange={(e) => set('tipo', e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
        {info.filters.includes('warehouse') && (
          <div className="field">
            <label htmlFor="rf-wh">Bodega</label>
            <select id="rf-wh" value={filters.warehouseId} onChange={(e) => set('bodega', e.target.value)}>
              <option value="">Todas</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
        {info.filters.includes('category') && (
          <div className="field">
            <label htmlFor="rf-cat">Categoría</label>
            <select id="rf-cat" value={filters.categoryId} onChange={(e) => set('categoria', e.target.value)}>
              <option value="">Todas</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {info.filters.includes('flagged') && (
          <label className="check report-check">
            <input type="checkbox" checked={filters.onlyFlagged} onChange={(e) => set('revisar', e.target.checked ? '1' : '')} />
            Solo productos para revisar
          </label>
        )}
        <div className="report-actions">
          <button type="button" className="btn btn-primary" onClick={() => download('xlsx')} disabled={!!downloading || !report || report.total === 0}>
            {downloading === 'xlsx' ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" size={18} />}
            {downloading === 'xlsx' ? 'Generando…' : 'Descargar Excel'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => download('pdf')} disabled={!!downloading || !report || report.total === 0}>
            {downloading === 'pdf' ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" size={18} />}
            {downloading === 'pdf' ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      </section>

      <p className="sr-only" role="status">{downloaded ? `Descargaste ${downloaded}` : ''}</p>
      {downloaded && <Alert kind="success">Listo: descargaste <strong>{downloaded}</strong>.</Alert>}
      {error && <Alert>{error}</Alert>}

      <section className={`card report-preview ${loading ? 'is-loading' : ''}`} aria-busy={loading} aria-labelledby="report-title">
        <header className="report-head">
          <div>
            <h2 id="report-title">{report?.title ?? info.title}</h2>
            {report && <p className="muted small">{report.subtitle}</p>}
          </div>
          {report && (
            <span className="report-count small">
              {report.total === 0 ? 'Sin filas' : report.total > report.rows.length ? `Vista previa: ${report.rows.length} de ${report.total.toLocaleString('es-CO')} filas` : `${report.total.toLocaleString('es-CO')} filas`}
            </span>
          )}
        </header>
        {report && (report.filtersApplied.length > 0 || report.notes.length > 0) && (
          <div className="report-meta">
            {report.filtersApplied.map((f) => (
              <span key={f.label} className="chip chip-soft">{f.label}: {f.value}</span>
            ))}
            {report.notes.map((n) => <span key={n} className="small muted">{n}</span>)}
          </div>
        )}
        {report && report.rows.length > 0 ? (
          <div className="table-wrap report-table">
            <table className="table">
              <thead>
                <tr>{report.columns.map((c) => <th key={c.key} className={NUMERIC_TYPES.has(c.type) ? 'num' : ''}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i}>
                    {report.columns.map((c) => (
                      <td key={c.key} data-label={c.label} className={NUMERIC_TYPES.has(c.type) ? 'num' : c.type === 'code' ? 'code' : ''}>
                        {formatCell(row[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.totals && (
                <tfoot>
                  <tr>
                    {report.columns.map((c) => (
                      <td key={c.key} data-label={c.label} className={NUMERIC_TYPES.has(c.type) ? 'num' : ''}>
                        {report.totals![c.key] === undefined ? '' : formatCell(report.totals![c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          !loading && <p className="empty">No hay datos con estos filtros.</p>
        )}
        {loading && !report && <p className="empty">Cargando…</p>}
      </section>
    </div>
  )
}
