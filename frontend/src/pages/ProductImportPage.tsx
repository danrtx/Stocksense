import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, saveBlob, uploadFile } from '../api/client'
import type { ProductImportResult } from '../api/types'
import { Alert, PageHeader, Progress } from '../components/ui'
import { csvBlob } from '../lib/csv'
import { formatNumber } from '../lib/format'

/** HU-05: cargar el catálogo desde un CSV con barra de progreso y resumen. */
export function ProductImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [createCategories, setCreateCategories] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<ProductImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return setError('Elige el archivo CSV.')
    setError(null)
    setResult(null)
    setProgress(0)
    try {
      const res = await uploadFile<ProductImportResult>(`/products/import?createCategories=${createCategories}`, file, setProgress)
      setResult(res)
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setProgress(null)
    }
  }

  function downloadErrors() {
    if (!result) return
    saveBlob(csvBlob([['fila', 'sku', 'motivo'], ...result.errors.map((e) => [e.line, e.sku, e.message])]), `errores-${result.fileName}`)
  }

  return (
    <>
      <Link to="/productos" className="back-link">← Productos</Link>
      <PageHeader title="Importar productos" subtitle="Crea o actualiza tu catálogo desde un archivo CSV" />

      <div className="detail-grid">
        <section className="card dash-card">
          <h2>1. Descarga la plantilla</h2>
          <p className="small">Llénala en Excel o Google Sheets y guárdala como <strong>CSV UTF-8</strong>.</p>
          <a className="btn btn-ghost" href="/plantillas/plantilla-productos.csv" download>Descargar plantilla</a>
          <ul className="instructions small">
            <li><strong>sku</strong>: código único (letras, números, punto, guion). Si ya existe, el producto se actualiza.</li>
            <li><strong>nombre</strong>, <strong>categoria</strong>, <strong>unidad</strong> (UND, KG, G, L, ML, M, CAJA o PAQ) y <strong>costo</strong> son obligatorios.</li>
            <li><strong>descripcion</strong>, <strong>punto_reorden</strong> y <strong>stock_seguridad</strong> son opcionales; si la celda va vacía, se deja el valor actual.</li>
            <li>Números sin separador de miles; los decimales pueden ir con punto o coma.</li>
            <li>Sirve con coma o punto y coma como separador. Máximo 20.000 filas por archivo.</li>
          </ul>
        </section>

        <section className="card dash-card">
          <h2>2. Sube el archivo</h2>
          {error && <Alert>{error}</Alert>}
          <form onSubmit={submit}>
            <label htmlFor="imp-file">Archivo CSV</label>
            <input id="imp-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <label className="check">
              <input type="checkbox" checked={createCategories} onChange={(e) => setCreateCategories(e.target.checked)} />
              Crear las categorías que todavía no existan
            </label>
            {progress !== null && (
              <div className="upload-progress">
                <Progress value={progress < 100 ? progress : undefined} label="Progreso de la importación" />
                <p className="muted small">{progress < 100 ? `Subiendo… ${progress}%` : 'Validando y guardando fila por fila…'}</p>
              </div>
            )}
            <button className="btn btn-primary btn-block" disabled={progress !== null || !file}>Importar</button>
          </form>
        </section>
      </div>

      {result && (
        <section className="card dash-card section-block" aria-live="polite">
          <h2>Resumen de {result.fileName}</h2>
          <div className="result-stats">
            <div><span className="muted small">Creados</span><strong>{formatNumber(result.created)}</strong></div>
            <div><span className="muted small">Actualizados</span><strong>{formatNumber(result.updated)}</strong></div>
            <div className={result.failed ? 'is-error' : ''}><span className="muted small">Con error</span><strong>{formatNumber(result.failed)}</strong></div>
            <div><span className="muted small">Tiempo</span><strong>{(result.durationMs / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} s</strong></div>
          </div>
          {result.newCategories.length > 0 && <p className="small">Categorías nuevas: {result.newCategories.join(', ')}.</p>}
          {result.failed > 0 && (
            <>
              <p className="small">Las filas con error no se guardaron; las demás sí. Corrige el archivo de errores y vuelve a subir solo esas filas.</p>
              <button className="btn btn-ghost" onClick={downloadErrors}>Descargar archivo de errores</button>
              <div className="table-wrap error-table">
                <table className="table">
                  <thead><tr><th>Fila</th><th>SKU</th><th>Motivo</th></tr></thead>
                  <tbody>
                    {result.errors.slice(0, 50).map((e) => (
                      <tr key={e.line}><td data-label="Fila">{e.line}</td><td data-label="SKU"><code>{e.sku || '—'}</code></td><td data-label="Motivo">{e.message}</td></tr>
                    ))}
                  </tbody>
                </table>
                {result.errors.length > 50 && <p className="empty">…y {result.errors.length - 50} más en el archivo de errores.</p>}
              </div>
            </>
          )}
          {result.failed === 0 && <Alert kind="success">Todas las filas quedaron guardadas.</Alert>}
        </section>
      )}
    </>
  )
}
