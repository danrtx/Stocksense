import { Outlet } from 'react-router-dom'
import { SubNav } from '../../components/ui'

export function ForecastLayout() {
  return (
    <>
      <SubNav
        label="Secciones de pronóstico"
        items={[
          { to: '/pronostico', label: 'Resumen', end: true },
          { to: '/pronostico/precision', label: 'Precisión' },
          { to: '/pronostico/modelos', label: 'Modelos' },
          { to: '/pronostico/datos', label: 'Datos' },
        ]}
      />
      <Outlet />
    </>
  )
}
