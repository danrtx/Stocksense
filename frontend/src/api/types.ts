import type { Page } from './client'

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
  | 'warehouses:manage'
  | 'counts:approve'
  | 'purchases:receive'
  | 'sales:import'
  | 'integrations:manage'
  | 'alerts:read'
  | 'forecast:run'
  | 'ai:manage'

export interface Profile {
  id: string
  email: string
  fullName: string
  role: Role
  permissions: Permission[]
  preferences?: { notifyStockAlertsEmail: boolean }
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
  reorderPoint: number | null
  safetyStock: number | null
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

// ---------- Sprints 2 a 5 ----------
export interface ProductRef {
  id: string
  sku: string
  name: string
  unit: Unit
}

export interface Warehouse {
  id: string
  code: string
  name: string
  address: string | null
  isActive: boolean
  isDefault: boolean
  productsWithStock?: number
  totalUnits?: number
}

export type StockStatus = 'OUT' | 'LOW' | 'OK'

export interface StockRow {
  id: string
  sku: string
  name: string
  unit: Unit
  category: string
  reorderPoint: number | null
  safetyStock: number | null
  quantity: number
  inTransit: number
  total: number
  value?: number
  status: StockStatus
  byWarehouse: Record<string, number>
}

export interface StockPage extends Page<StockRow> {
  warehouses: Warehouse[]
}

export type MovementType =
  | 'IN'
  | 'OUT'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_CANCEL'
  | 'PURCHASE_RECEIPT'
  | 'SALE'

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  IN: 'Entrada',
  OUT: 'Salida',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_OUT: 'Transferencia (sale)',
  TRANSFER_IN: 'Transferencia (llega)',
  TRANSFER_CANCEL: 'Transferencia cancelada',
  PURCHASE_RECEIPT: 'Recepción de compra',
  SALE: 'Venta',
}

export interface Movement {
  id: string
  type: MovementType
  quantity: number
  balanceAfter: number
  reason: string
  referenceType: string | null
  referenceId: string | null
  createdAt: string
  product: ProductRef
  warehouse: { id: string; name: string }
  userName: string | null
}

export interface ProductStock {
  product: ProductRef & { isActive: boolean; reorderPoint: number | null; safetyStock: number | null }
  warehouses: { id: string; code: string; name: string; isActive: boolean; quantity: number }[]
  onHand: number
  inTransit: number
  total: number
  status: StockStatus
  movements: Movement[]
}

export interface Transfer {
  id: string
  code: string
  status: 'PENDING' | 'RECEIVED' | 'CANCELLED'
  notes: string | null
  createdAt: string
  receivedAt: string | null
  cancelledAt: string | null
  from: { id: string; name: string }
  to: { id: string; name: string }
  createdBy: string | null
  receivedBy: string | null
  cancelledBy: string | null
  lineCount: number
  totalQuantity: number
  lines?: { id: string; quantity: number; product: ProductRef }[]
}

export type CountStatus = 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface StockCount {
  id: string
  code: string
  status: CountStatus
  notes: string | null
  reviewNotes: string | null
  createdAt: string
  submittedAt: string | null
  reviewedAt: string | null
  warehouse: { id: string; name: string }
  createdBy: string | null
  submittedBy: string | null
  reviewedBy: string | null
  lineCount: number
  countedCount: number
}

export interface StockCountDetail extends StockCount {
  lines: {
    productId: string
    sku: string
    name: string
    unit: Unit
    countedQty: number | null
    systemQty: number | null
    difference: number | null
  }[]
  summary: { lines: number; counted: number; withDifference: number; surplus: number; shortage: number }
}

export interface Supplier {
  id: string
  name: string
  taxId: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  leadTimeDays: number
  notes?: string | null
  isActive: boolean
  createdAt: string
  actualLeadTimeDays: number | null
  receipts: number
  productCount?: number
  openOrders?: number
}

export interface SupplierDetail extends Supplier {
  orders: { total: number; open: number }
  products: (ProductRef & { isActive: boolean; isPrimary: boolean; supplierSku: string | null; unitCost: number | null })[]
}

export interface ProductSupplier {
  id: string
  name: string
  leadTimeDays: number
  isActive: boolean
  isPrimary: boolean
  supplierSku: string | null
  unitCost: number | null
}

export type OrderStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  PARTIALLY_RECEIVED: 'Recibida parcial',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
}

export interface OrderRow {
  id: string
  code: string
  status: OrderStatus
  expectedAt: string | null
  createdAt: string
  sentAt: string | null
  receivedAt: string | null
  total?: number
  supplier: { id: string; name: string }
  warehouse: { id: string; name: string }
  lineCount: number
  orderedQty: number
  receivedQty: number
}

export interface OrderDetail {
  id: string
  code: string
  status: OrderStatus
  expectedAt: string | null
  notes: string | null
  total?: number
  createdAt: string
  sentAt: string | null
  receivedAt: string | null
  createdBy: string | null
  supplier: { id: string; name: string; taxId: string | null; contactName: string | null; email: string | null; phone: string | null; leadTimeDays: number }
  warehouse: { id: string; name: string; address: string | null }
  lines: {
    id: string
    product: ProductRef
    supplierSku: string | null
    quantity: number
    unitCost?: number
    subtotal?: number
    receivedQty: number
    pendingQty: number
  }[]
  receipts: {
    id: string
    receivedOn: string
    leadTimeDays: number | null
    overReceipt: boolean
    notes: string | null
    createdBy: string | null
    lines: { sku: string; quantity: number; overQuantity: number }[]
  }[]
}

export interface ImportRowError {
  line: number
  sku: string
  message: string
}

export interface ProductImportResult {
  fileName: string
  rowsTotal: number
  created: number
  updated: number
  failed: number
  newCategories: string[]
  errors: ImportRowError[]
  durationMs: number
}

export interface SalesQuality {
  dateFrom: string | null
  dateTo: string | null
  daysCovered: number
  daysWithoutSales: number
  gaps: { from: string; to: string; days: number }[]
  negativeQuantities: number
  zeroQuantities: number
  futureDates: number
  invalidDates: number
  invalidQuantities: number
  unknownSkus: { count: number; rows: number; sample: string[] }
  mergedRows: number
  products: number
  productsWithShortHistory: number
}

export interface SalesImportResult {
  importId: string
  fileName: string
  rowsTotal: number
  salesDays: number
  created: number
  updated: number
  unchanged: number
  failed: number
  errors: ImportRowError[]
  errorsTruncated: boolean
  quality: SalesQuality
  durationMs: number
}

export interface SalesImportRow {
  id: string
  fileName: string
  rowsTotal: number
  rowsImported: number
  rowsFailed: number
  durationMs: number
  createdAt: string
  createdBy: string | null
  quality: SalesQuality
}

export interface SalesOverview {
  rows: number
  units: number
  dateFrom: string | null
  dateTo: string | null
  products: number
  apiSales: number
  importedDays: number
  monthly: { month: string; units: number }[]
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdBy: string | null
  key?: string
}

export type AlertStatus = 'OPEN' | 'SEEN' | 'RESOLVED'

export interface StockAlert {
  id: string
  status: AlertStatus
  stockAtOpen: number
  currentStock: number
  reorderPoint: number
  openedAt: string
  seenAt: string | null
  resolvedAt: string | null
  seenBy: string | null
  product: ProductRef
  primarySupplier: string | null
}

export interface PipelineRun {
  id: string
  trigger: 'MANUAL' | 'SCHEDULED'
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  startedAt: string
  finishedAt: string | null
  productsTotal: number | null
  productsReady: number | null
  productsInsufficient: number | null
  weeksWritten: number | null
  error: string | null
  requestedBy: string | null
}

export interface ForecastDataStatus {
  configured: boolean
  series: { total: number; ready: number; insufficient: number; updatedAt: string | null; firstWeek: string | null; lastWeek: string | null }
  runs: PipelineRun[]
}

export interface SeriesRow extends ProductRef {
  status: 'READY' | 'INSUFFICIENT_DATA'
  weeksOfHistory: number
  firstWeek: string | null
  lastWeek: string | null
  totalQuantity: number
}

export interface Kpis {
  filters: { warehouseId: string | null; categoryId: string | null }
  inventoryValue?: number
  unitsOnHand: number
  productsWithStock: number
  activeProducts: number
  belowReorder: { count: number; withoutReorderPoint: number; top: (ProductRef & { stock: number; reorderPoint: number })[] }
  noMovement90d: { count: number; value?: number; top: (ProductRef & { stock: number; value?: number; lastMovementAt: string | null })[] }
  rotation: { value: number | null; basis: 'cost' | 'units'; daysOfInventory: number | null; salesWindowDays: number }
  generatedInMs: number
}

export interface ReorderSuggestion {
  avgDailyDemand: number
  daysWithSales: number
  supplier: { name: string; leadTimeDays: number; actualLeadTimeDays: number | null } | null
  leadTimeDays: number | null
  safetyStock: number
  suggestedReorderPoint: number | null
  formula: string
}

// ------------------------------------------------------------ Sprints 6 a 8

export type ForecastMethod = 'MOVING_AVERAGE' | 'SES' | 'HOLT_DAMPED' | 'CROSTON_SBA' | 'COMBO'

export interface ProductForecast {
  product: ProductRef & { category: string | null }
  status: 'READY' | 'INSUFFICIENT_DATA' | 'NO_SALES' | 'NOT_RUN'
  message: string | null
  weeksOfHistory: number
  horizonWeeks: number
  history: { week: string; quantity: number }[]
  forecast: { week: string; step: number; yhat: number; lo: number; hi: number }[]
  model: {
    runId: string
    version: number
    trainedAt: string
    dataLastWeek: string | null
    method: ForecastMethod
    methodLabel: string
    params: Record<string, unknown>
    testWape: number | null
    testBias: number | null
    baselineWape: number | null
    beatsBaseline: boolean | null
    testWeeks: number | null
    flagged: boolean
  } | null
}

export interface ForecastFacts {
  product: { sku: string; name: string; unit: string; category: string | null }
  horizonWeeks: number
  avgLast12: number | null
  trendPct: number | null
  forecastTotal: number
  forecastLowTotal: number
  forecastHighTotal: number
  forecastAvgWeekly: number
  changeVsLast12Pct: number | null
  sameWeeksLastYearTotal: number | null
  seasonalityPct: number | null
  testWapePct: number | null
  method: string | null
  warnings: string[]
}

export interface ExplainResult {
  status: 'OK' | 'UNAVAILABLE' | 'LIMIT' | 'FAILED' | 'REJECTED' | 'NOT_READY'
  message?: string | null
  explanation?: { tendencia: string; estacionalidad: string; advertencias: string }
  model?: string
  generatedAt?: string
  cached?: boolean
  facts: ForecastFacts | null
}

export interface ForecastSummaryRow extends ProductRef {
  method: ForecastMethod
  methodLabel: string
  testWape: number | null
  next4: number
  next4Lo: number
  next4Hi: number
  next12: number
  last4: number
  changePct: number | null
  flagged: boolean
}

export interface ForecastRunInfo {
  version: number
  trainedAt: string
  dataLastWeek: string | null
  overallWape: number | null
}

export interface AccuracyRow extends ProductRef {
  method: ForecastMethod
  methodLabel: string
  weeksOfHistory: number
  testWape: number | null
  testBias: number | null
  baselineWape: number | null
  beatsBaseline: boolean | null
  actual: number
  volume: number
  flagged: boolean
}

export interface AccuracyReport {
  run: (ForecastRunInfo & {
    testWeeks: number | null
    overallBias: number | null
    baselineWape: number | null
    top20Wape: number | null
    productsForecast: number
    beatsBaseline: number | null
  }) | null
  threshold: number
  flagged: number
  noSales: number
  top20: (ProductRef & { volume: number; testWape: number | null; testBias: number | null; actual: number; absError: number })[]
  items: AccuracyRow[]
  total: number
  page: number
  pages: number
}

export interface MlJob {
  id: string
  kind: 'FORECAST_RETRAIN' | 'ASSISTANT_TRAIN'
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'
  trigger: 'MANUAL' | 'SCHEDULED' | 'AUTO'
  attempts: number
  maxAttempts: number
  requestedBy: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  result: Record<string, unknown> | null
  alertSentAt: string | null
}

export interface ForecastRun {
  id: string
  version: number
  trigger: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  decision: 'ACCEPTED' | 'REJECTED' | null
  reason: string | null
  isActive: boolean
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  requestedBy: string | null
  dataLastWeek: string | null
  testWeeks: number | null
  productsForecast: number | null
  productsInsufficient: number | null
  overallWape: number | null
  baselineWape: number | null
  top20Wape: number | null
  previousWape: number | null
  methods: { method: ForecastMethod; label: string; count: number }[]
  error: string | null
  hasDetail: boolean
}

export interface ForecastModels {
  runs: ForecastRun[]
  jobs: MlJob[]
  schedule: { enabled: boolean; weekday: number; time: string; description: string }
}

export interface PurchaseSuggestion {
  product: ProductRef
  supplier: { id: string; name: string; leadTimeDays: number; leadTimeSource: 'ACTUAL' | 'AGREED' }
  quantity: number
  orderBy: string | null
  daysUntilOrder: number | null
  urgency: 'NOW' | 'WEEK' | 'LATER' | 'NONE'
  demandLeadReview: number
  position: number
  target: number
  coverageDays: number
  stockoutDate: string | null
  safetyStock: number
  safetyStockDefined: boolean
  onHand: number
  inTransit: number
  onOrder: number
  inDraft: number
  draftCode: string | null
  reviewDays: number
  unitCost?: number
  subtotal?: number
}

export interface SuggestionsResponse {
  run: { version: number; trainedAt: string } | null
  today: string
  reviewDays: number
  items: PurchaseSuggestion[]
  suppliers: { id: string; name: string; count: number }[]
  withoutSupplier: number
  withoutForecast: number
}

export interface AiSettings {
  assistantConfidenceThreshold: number
  forecastErrorThreshold: number
  retrain: { enabled: boolean; weekday: number; time: string }
  monthlyLimitPerUser: number
  updatedAt: string | null
  retrainDescription: string
}

export interface AiUsage {
  configured: boolean
  model: string
  timeoutSeconds: number
  monthlyLimitPerUser: number
  totals: { calls: number; ok: number; failed: number; rejected: number; promptTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number }
  byUser: { id: string; fullName: string; email: string; role: Role; calls: number; tokens: number; costUsd: number; explain: number; assistant: number }[]
  recent: { createdAt: string; feature: string; status: string; model: string; promptTokens: number; outputTokens: number; costUsd: number; latencyMs: number | null; detail: string | null; user: string | null }[]
}

export interface AiFeedback {
  id: string
  feature: 'EXPLAIN' | 'ASSISTANT'
  targetId: string | null
  content: string
  comment: string | null
  createdAt: string
  user: string | null
}

export interface AssistantModelVersion {
  id: string
  version: number
  status: 'READY' | 'REJECTED' | 'FAILED'
  isActive: boolean
  accuracy: number | null
  trainSize: number | null
  testSize: number | null
  articles: number | null
  reason: string | null
  durationMs: number | null
  trainedAt: string
  latencyMsAvg: number | null
  thresholds: { threshold: number; coverage: number; accuracy: number | null }[] | null
  confusions: { expected: string; predicted: string; count: number }[] | null
}

export interface AssistantModels {
  versions: AssistantModelVersion[]
  knowledge: { articles: number; examples: number }
  answers: { total: number; model: number; gemini: number; fallback: number; noPermission: number }
  jobs: MlJob[]
}

export type AnswerSource = 'MODEL' | 'CONTEXT' | 'GEMINI' | 'FALLBACK' | 'NO_PERMISSION'

export interface ChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  source: AnswerSource | null
  articleId: string | null
  confidence: number | null
  modelVersion: number | null
  createdAt: string
  title?: string
  steps?: string[]
  route?: string | null
  routeLabel?: string
  suggestions?: { id: string; title: string; route: string | null }[]
  notice?: string
}
