import type { AuditItem } from '../api/types'

export const ACTION_LABELS: Record<string, string> = {
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
  'product.imported': 'Catálogo importado',
  'product.reorder_updated': 'Punto de reorden editado',
  'product.reorder_bulk_updated': 'Punto de reorden por categoría',
  'user.preferences_updated': 'Preferencias cambiadas',
  'warehouse.created': 'Bodega creada',
  'warehouse.updated': 'Bodega editada',
  'warehouse.deactivated': 'Bodega desactivada',
  'warehouse.reactivated': 'Bodega reactivada',
  'warehouse.made_default': 'Bodega principal',
  'transfer.created': 'Transferencia creada',
  'transfer.received': 'Transferencia recibida',
  'transfer.cancelled': 'Transferencia cancelada',
  'count.created': 'Conteo iniciado',
  'count.submitted': 'Conteo enviado',
  'count.approved': 'Conteo aprobado',
  'count.rejected': 'Conteo rechazado',
  'supplier.created': 'Proveedor creado',
  'supplier.updated': 'Proveedor editado',
  'supplier.deactivated': 'Proveedor desactivado',
  'supplier.reactivated': 'Proveedor reactivado',
  'supplier.deleted': 'Proveedor eliminado',
  'supplier.product_assigned': 'Producto asignado a proveedor',
  'supplier.product_unassigned': 'Producto quitado de proveedor',
  'purchase_order.created': 'Orden de compra creada',
  'purchase_order.updated': 'Orden de compra editada',
  'purchase_order.sent': 'Orden de compra enviada',
  'purchase_order.cancelled': 'Orden de compra cancelada',
  'purchase_order.received': 'Mercancía recibida',
  'sales.imported': 'Ventas importadas',
  'api_key.created': 'Clave de API creada',
  'api_key.revoked': 'Clave de API revocada',
  'forecast.pipeline_run': 'Datos del modelo preparados',
  'demo.seeded': 'Datos de demostración cargados',
}

const FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  name: 'Nombre',
  fullName: 'Nombre',
  email: 'Correo',
  role: 'Rol',
  status: 'Estado',
  cost: 'Costo',
  unit: 'Unidad',
  description: 'Descripción',
  categoryId: 'Categoría',
  isActive: 'Activo',
  reason: 'Motivo',
  lockedUntil: 'Bloqueada hasta',
  ip: 'IP',
  reorderPoint: 'Punto de reorden',
  safetyStock: 'Stock de seguridad',
  leadTimeDays: 'Días de entrega',
  contactName: 'Contacto',
  phone: 'Teléfono',
  taxId: 'NIT',
  code: 'Código',
  address: 'Dirección',
  number: 'Número',
  warehouse: 'Bodega',
  from: 'Desde',
  to: 'Hacia',
  lines: 'Líneas',
  total: 'Total',
  supplier: 'Proveedor',
  file: 'Archivo',
  created: 'Creados',
  updated: 'Actualizados',
  unchanged: 'Sin cambios',
  failed: 'Con error',
  rows: 'Filas',
  products: 'Productos',
  sales: 'Ventas',
  notes: 'Nota',
  prefix: 'Prefijo',
  receivedOn: 'Llegó',
  notifyStockAlertsEmail: 'Alertas por correo',
  adjustments: 'Ajustes',
  counted: 'Contados',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'sí' : 'no'
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    return new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function describeChanges(changes: AuditItem['changes']): string {
  if (!changes) return ''
  return Object.entries(changes)
    .map(([key, value]) => {
      const label = FIELD_LABELS[key] ?? key
      if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
        const v = value as { from: unknown; to: unknown }
        return `${label}: ${show(v.from)} → ${show(v.to)}`
      }
      return `${label}: ${show(value)}`
    })
    .join(' · ')
}
