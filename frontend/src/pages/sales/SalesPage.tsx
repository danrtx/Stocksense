import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, saveBlob, uploadFile } from '../../api/client'
import type { SalesImportResult, SalesImportRow, SalesOverview, SalesQuality } from '../../api/types'
import { Alert, PageHeader, Progress } from '../../components/ui'
import { csvBlob } from '../../lib/csv'
import { compactNumber, formatDate, formatDateOnly, formatNumber, formatQty, plural } from '../../lib/format'

/** HU-13: carga del historial de ventas con informe de calidad de datos. */
export function SalesPage() {
  const [overview, setOverview] = useState<SalesOverview | null>(null)
  const [imports, setImports] = useState<SalesImportRow[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<SalesImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<SalesOverview>('/sales/overview').then(setOverview).catch(() => undefined)
    api<SalesImportRow[]>('/sales/imports?limit=10').then(setImports).catch(() => undefined)
  }, [])
  useEffect(load, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return setError('Elige el archivo CSV.')
    setError(null)
    setResult(null)
    setProgress(0)
    try {
      setResult(await uploadFile<SalesImportResult>('/sales/import', file, setProgress))
      load()
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setProgress(null)
    }
  }

  const max = Math.max(1, ...(overview?.monthly.map((m) => m.units) ?? [1]))

  return (
    <>
      <PageHeader title="Historial de ventas" subtitle="Las ventas pasadas son la base del pronóstico de demanda" />

      {overview && overview.rows > 0 && (
        <section className="card dash-card section-block">
          <div className="result-stats">
            <div><span className="muted small">Desde</span><strong>{formatDateOnly(overview.dateFrom)}</strong></div>
            <div><span className="muted small">Hasta</span><strong>{formatDateOnly(overview.dateTo)}</strong></div>
            <div><span className="muted small">Productos con ventas</span><strong>{formatNumber(overview.products)}</strong></div>
            <div><span className="muted small">Unidades vendidas</span><strong>{compactNumber(overview.units)}</strong></div>
            <div><span className="muted small">Ventas del punto de venta</span><strong>{formatNumber(overview.apiSales)}</strong></div>
          </div>
          {overview.monthly.length > 0 && (
            <div className="month-bars" role="img" aria-label={`Unidades vendidas por mes en los últimos ${overview.monthly.length} meses`}>
              {overview.monthly.map((m) => (
                <div key={m.month} className="month-bar" title={`${m.month}: ${formatQty(m.units)} unidades`}>
                  <span style={{ height: `${Math.max(2, (m.units / max) * 100)}%` }} />
                  <small>{m.month.slice(5)}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="detail-grid">
        <section className="card dash-card">
          <h2>Formato del archivo</h2>
          <a className="btn btn-ghost" href="/plantillas/plantilla-ventas.csv" download>Descargar plantilla</a>
          <ul className="instructions small">
            <li><strong>fecha</strong> (AAAA-MM-DD o DD/MM/AAAA), <strong>sku</strong> y <strong>cantidad</strong> son obligatorias.</li>
            <li><strong>bodega</strong> (código o nombre) y <strong>precio</strong> son opcionales. Sin bodega, se usa la principal.</li>
            <li>Se guarda una venta por producto, bodega y día: si hay varias filas del mismo día, se suman.</li>
            <li>Puedes volver a subir el mismo archivo: lo que ya existe se actualiza, no se duplica.</li>
            <li>Estas ventas son historia: no cambian el stock actual.</li>
          </ul>
        </section>

        <section className="card dash-card">
          <h2>Subir historial</h2>
          {error && <Alert>{error}</Alert>}
          <form onSubmit={submit}>
            <label htmlFor="sales-file">Archivo CSV (hasta 60 MB)</label>
            <input id="sales-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {progress !== null && (
              <div className="upload-progress">
                <Progress value={progress < 100 ? progress : undefined} label="Progreso de la carga" />
                <p className="muted small">{progress < 100 ? `Subiendo… ${progress}%` : 'Revisando y guardando las ventas…'}</p>
              </div>
            )}
            <button className="btn btn-primary btn-block" disabled={progress !== null || !file}>Cargar ventas</button>
          </form>
        </section>
      </div>

      {result && <ImportResult result={result} />}

      {imports.length > 0 && (
        <section className="section-block">
          <h2>Cargas anteriores</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Archivo</th><th>Fecha</th><th>Quién</th><th className="num">Filas</th><th className="num">Guardadas</th><th className="num">Con error</th><th>Rango</th></tr></thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Archivo">{i.fileName}</td>
                    <td data-label="Fecha">{formatDate(i.createdAt)}</td>
                    <td data-label="Quién">{i.createdBy ?? '—'}</td>
                    <td data-label="Filas" className="num">{formatNumber(i.rowsTotal)}</td>
                    <td data-label="Guardadas" className="num">{formatNumber(i.rowsImported)}</td>
                    <td data-label="Con error" className="num">{formatNumber(i.rowsFailed)}</td>
                    <td data-label="Rango">{formatDateOnly(i.quality.dateFrom)} – {formatDateOnly(i.quality.dateTo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function ImportResult({ result }: { result: SalesImportResult }) {
  function downloadErrors() {
    saveBlob(csvBlob([['fila', 'sku', 'motivo'], ...result.errors.map((e) => [e.line, e.sku, e.message])]), `errores-${result.fileName}`)
  }
  return (
    <section className="card dash-card section-block" aria-live="polite">
      <h2>Resultado de {result.fileName}</h2>
      <div className="result-stats">
        <div><span className="muted small">Filas leídas</span><strong>{formatNumber(result.rowsTotal)}</strong></div>
        <div><span className="muted small">Ventas nuevas</span><strong>{formatNumber(result.created)}</strong></div>
        <div><span className="muted small">Actualizadas</span><strong>{formatNumber(result.updated)}</strong></div>
        <div><span className="muted small">Sin cambios</span><strong>{formatNumber(result.unchanged)}</strong></div>
        <div className={result.failed ? 'is-error' : ''}><span className="muted small">Con error</span><strong>{formatNumber(result.failed)}</strong></div>
        <div><span className="muted small">Tiempo</span><strong>{(result.durationMs / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} s</strong></div>
      </div>
      <QualityReport quality={result.quality} />
      {result.failed > 0 && (
        <>
          <p className="small">
            Las filas con error no se cargaron y el resto sí.{result.errorsTruncated && ` El archivo de errores incluye las primeras ${result.errors.length}.`}
          </p>
          <button className="btn btn-ghost" onClick={downloadErrors}>Descargar archivo de errores</button>
        </>
      )}
    </section>
  )
}

/** T-13.3: informe de calidad de datos. */
function QualityReport({ quality }: { quality: SalesQuality }) {
  const issues: { label: string; value: number; hint: string }[] = [
    { label: 'SKU que no existen', value: quality.unknownSkus.rows, hint: quality.unknownSkus.sample.length ? `Ej.: ${quality.unknownSkus.sample.slice(0, 5).join(', ')}` : '' },
    { label: 'Cantidades negativas', value: quality.negativeQuantities, hint: 'Las devoluciones no se cargan como ventas.' },
    { label: 'Fechas futuras', value: quality.futureDates, hint: 'Revisa el formato de fecha del archivo.' },
    { label: 'Fechas inválidas', value: quality.invalidDates, hint: '' },
    { label: 'Cantidades que no son número', value: quality.invalidQuantities, hint: '' },
    { label: 'Cantidades en 0', value: quality.zeroQuantities, hint: '' },
  ].filter((i) => i.value > 0)
  return (
    <div className="quality">
      <h3>Calidad de los datos</h3>
      <p className="small">
        Periodo: {formatDateOnly(quality.dateFrom)} – {formatDateOnly(quality.dateTo)} · {plural(quality.products, 'producto', 'productos')} ·{' '}
        {plural(quality.daysCovered, 'día con ventas', 'días con ventas')} · {plural(quality.daysWithoutSales, 'día sin ventas', 'días sin ventas')}
        {quality.mergedRows > 0 && ` · ${plural(quality.mergedRows, 'fila sumada', 'filas sumadas')} por ser del mismo día`}
      </p>
      {issues.length === 0 ? (
        <Alert kind="success">No encontramos problemas en las filas.</Alert>
      ) : (
        <ul className="line-list">
          {issues.map((i) => <li key={i.label}><span>{i.label}{i.hint && <span className="cell-note">{i.hint}</span>}</span><strong>{formatNumber(i.value)}</strong></li>)}
        </ul>
      )}
      {quality.gaps.length > 0 && (
        <Alert kind="info">
          Huecos de 7 días o más sin ninguna venta: {quality.gaps.slice(0, 3).map((g) => `${formatDateOnly(g.from)} – ${formatDateOnly(g.to)} (${g.days} días)`).join('; ')}
          {quality.gaps.length > 3 && ` y ${quality.gaps.length - 3} más`}. Si la tienda sí vendió esos días, falta información en el archivo.
        </Alert>
      )}
      {quality.productsWithShortHistory > 0 && (
        <p className="small muted">{plural(quality.productsWithShortHistory, 'producto tiene', 'productos tienen')} menos de 12 semanas de historia en este archivo; no tendrán pronóstico estadístico hasta acumular más.</p>
      )}
    </div>
  )
}
