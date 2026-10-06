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
