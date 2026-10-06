import { Link } from 'react-router-dom'

export function AccessDenied() {
  return (
    <div className="empty-state">
      <h1>Acceso denegado</h1>
      <p className="muted">Tu rol no tiene permiso para ver esta sección. Si crees que es un error, habla con tu administrador.</p>
      <Link className="btn btn-primary" to="/">
        Volver al panel
      </Link>
    </div>
  )
}

export function ComingSoon({ title, sprint }: { title: string; sprint: string }) {
  return (
    <div className="empty-state">
      <h1>{title}</h1>
      <p className="muted">Esta sección llega en el {sprint}.</p>
    </div>
  )
}
