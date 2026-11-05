import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { api } from '../../api/client'
import type { AnomalyStatus } from '../../api/types'
import { SubNav } from '../../components/ui'

/** Sprint 9: Reportes (HU-28) y Anomalías (HU-26). */
export function ReportsLayout() {
  const [open, setOpen] = useState<number | undefined>()
  const location = useLocation()
  useEffect(() => {
    api<Record<AnomalyStatus, number>>('/anomalies/counts')
      .then((c) => setOpen(c.OPEN))
      .catch(() => undefined)
  }, [location.pathname])
  return (
    <>
      <SubNav
        label="Secciones de reportes"
        items={[
          { to: '/reportes', label: 'Exportar reportes', end: true },
          { to: '/reportes/anomalias', label: 'Anomalías', badge: open },
        ]}
      />
      <Outlet />
    </>
  )
}
