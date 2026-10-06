export type Role = 'ADMIN' | 'COMPRAS' | 'BODEGA' | 'ANALISTA'
export type UserStatus = 'INVITED' | 'ACTIVE' | 'DISABLED'

export type Permission =
  | 'users:manage'
  | 'audit:read'
  | 'products:read'
  | 'products:write'
  | 'products:cost:read'
  | 'stock:read'
  | 'stock:write'
  | 'purchases:read'
  | 'purchases:write'
  | 'reports:read'
  | 'forecast:read'

export interface Profile {
  id: string
  email: string
  fullName: string
  role: Role
  permissions: Permission[]
}

export interface UserRow {
  id: string
  email: string
  fullName: string
  role: Role
  status: UserStatus
  lockedUntil: string | null
  lastLoginAt: string | null
  createdAt: string
}

export interface Category {
  id: string
  name: string
}

export type Unit = 'UND' | 'KG' | 'G' | 'L' | 'ML' | 'M' | 'CAJA' | 'PAQ'

export interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  categoryId: string
  category: Category | null
  unit: Unit
  cost?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AuditItem {
  id: string
  actorEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  changes: Record<string, unknown> | null
  createdAt: string
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  COMPRAS: 'Compras',
  BODEGA: 'Bodega',
  ANALISTA: 'Analista',
}

export const STATUS_LABELS: Record<UserStatus, string> = {
  INVITED: 'Invitado',
  ACTIVE: 'Activo',
  DISABLED: 'Desactivado',
}

export const UNIT_LABELS: Record<Unit, string> = {
  UND: 'Unidad',
  KG: 'Kilogramo',
  G: 'Gramo',
  L: 'Litro',
  ML: 'Mililitro',
  M: 'Metro',
  CAJA: 'Caja',
  PAQ: 'Paquete',
}

export interface DashboardSummary {
  catalog: { active: number; inactive: number; categories: number; createdLast7Days: number; averageCost?: number | null }
  byCategory: { id: string; name: string; count: number; averageCost?: number | null }[]
  recentProducts: { id: string; sku: string; name: string; unit: Unit; cost?: number; createdAt: string; category: string }[]
  team?: { active: number; invited: number; locked: number; members: { id: string; fullName: string; role: Role }[] }
  activity?: AuditItem[]
}
