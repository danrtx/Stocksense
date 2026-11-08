/**
 * Generador de los datos de demostración (sin base de datos: solo cálculo).
 *
 * Simula 18 meses de una ferretería de Pasto con tres puntos: la bodega principal, la
 * bodega norte y el punto de venta sur. Las ventas siguen el día de la semana, la quincena,
 * los festivos y la temporada de cada categoría (obras en vacaciones, lluvias de abril y
 * octubre, pintura y luces en diciembre). En los últimos 150 días también se simula el
 * inventario: compras a cada proveedor con su tiempo de entrega, transferencias a las
 * sucursales, conteos físicos y alertas. Si un producto se queda sin stock, deja de venderse
 * en esa bodega, igual que en la vida real.
 *
 * Todo sale de una semilla fija: dos equipos que corran la demo el mismo día obtienen los
 * mismos datos.
 */

export type Unit = 'UND' | 'CAJA' | 'PAQ' | 'M' | 'KG' | 'L';
export type Season = 'plana' | 'obra' | 'lluvias' | 'pintura' | 'navidad' | 'jardin' | 'herramienta';
export type WarehouseCode = 'PRINCIPAL' | 'NORTE' | 'SUR';
export type DemoUser = 'admin' | 'marta' | 'bruno' | 'lina';

interface CatalogItem {
  sku: string;
  name: string;
  category: string;
  unit: Unit;
  cost: number;
  /** Ventas promedio por día en temporada normal, sumando las tres bodegas. */
  rate: number;
  season: Season;
  /** Crecimiento por año (0.15 = 15 % más cada año). */
  growth?: number;
  /** Producto nuevo: solo tiene esta cantidad de días de historia. */
  newDays?: number;
  /** Dejó de venderse hace este número de días (stock quieto). */
  stoppedDays?: number;
  inactive?: boolean;
  /** Sin punto de reorden definido (para ver el aviso en la pantalla). */
  noReorder?: boolean;
  /** Se deja caer bajo el punto de reorden al final de la simulación. */
  low?: boolean;
  /** Se deja agotar en la bodega principal. */
  out?: boolean;
  /** Múltiplo de compra (cajas de 12, rollos de 100 m...). */
  pack?: number;
  description?: string;
}

export const CATALOG: CatalogItem[] = [
  // Herramientas
  { sku: 'MAR-016', name: 'Martillo de uña 16 oz mango de fibra', category: 'Herramientas', unit: 'UND', cost: 25900, rate: 1.6, season: 'herramienta', pack: 6 },
  { sku: 'DES-PH2', name: 'Destornillador de estrella PH2', category: 'Herramientas', unit: 'UND', cost: 8500, rate: 2.4, season: 'herramienta', pack: 12 },
  { sku: 'DES-JGO6', name: 'Juego de destornilladores x 6', category: 'Herramientas', unit: 'UND', cost: 31500, rate: 0.7, season: 'herramienta', pack: 4, low: true },
  { sku: 'LLA-AJ10', name: 'Llave ajustable 10"', category: 'Herramientas', unit: 'UND', cost: 32000, rate: 0.9, season: 'herramienta', pack: 6 },
  { sku: 'ALI-8', name: 'Alicate universal 8"', category: 'Herramientas', unit: 'UND', cost: 21500, rate: 1.1, season: 'herramienta', pack: 6 },
  { sku: 'FLE-5M', name: 'Flexómetro 5 m', category: 'Herramientas', unit: 'UND', cost: 14900, rate: 2.2, season: 'herramienta', pack: 12 },
  { sku: 'TAL-13', name: 'Taladro percutor 1/2" 650 W', category: 'Herramientas', unit: 'UND', cost: 189000, rate: 0.35, season: 'herramienta', pack: 1, growth: 0.2 },
  { sku: 'PUL-412', name: 'Pulidora angular 4 1/2" 850 W', category: 'Herramientas', unit: 'UND', cost: 165000, rate: 0.25, season: 'herramienta', pack: 1, newDays: 52 },
  { sku: 'NIV-24', name: 'Nivel de burbuja 24"', category: 'Herramientas', unit: 'UND', cost: 23900, rate: 0.5, season: 'herramienta', pack: 4 },
  { sku: 'SEG-ARC', name: 'Segueta con arco 12"', category: 'Herramientas', unit: 'UND', cost: 18900, rate: 0.6, season: 'herramienta', pack: 6, noReorder: true },
  { sku: 'TAL-BAN', name: 'Taladro de banco 1/2" 350 W', category: 'Herramientas', unit: 'UND', cost: 489000, rate: 0.05, season: 'plana', pack: 1, stoppedDays: 130 },

  // Ferretería
  { sku: 'TOR-DRY6', name: 'Tornillo drywall 6 x 1" (caja x 100)', category: 'Ferretería', unit: 'CAJA', cost: 12800, rate: 3.2, season: 'obra', pack: 10 },
  { sku: 'TOR-MAD8', name: 'Tornillo para madera 8 x 1 1/2" (caja x 100)', category: 'Ferretería', unit: 'CAJA', cost: 15900, rate: 1.4, season: 'obra', pack: 10 },
  { sku: 'CHA-3/8', name: 'Chazo plástico 3/8" (paquete x 50)', category: 'Ferretería', unit: 'PAQ', cost: 4200, rate: 4.5, season: 'obra', pack: 20 },
  { sku: 'PUN-2.5', name: 'Puntilla con cabeza 2 1/2"', category: 'Ferretería', unit: 'KG', cost: 9800, rate: 6, season: 'obra', pack: 25 },
  { sku: 'CAN-50', name: 'Candado de seguridad 50 mm', category: 'Ferretería', unit: 'UND', cost: 27500, rate: 1.2, season: 'navidad', pack: 6 },
  { sku: 'BIS-3', name: 'Bisagra de cobre 3" (par)', category: 'Ferretería', unit: 'UND', cost: 3900, rate: 4, season: 'plana', pack: 24 },
  { sku: 'CER-POM', name: 'Cerradura de pomo para alcoba', category: 'Ferretería', unit: 'UND', cost: 38900, rate: 0.8, season: 'obra', pack: 6, out: true },
  { sku: 'SIL-TRA', name: 'Silicona transparente 280 ml', category: 'Ferretería', unit: 'UND', cost: 11900, rate: 2.6, season: 'lluvias', pack: 12 },
  { sku: 'LIJ-120', name: 'Lija de agua No. 120 (pliego)', category: 'Ferretería', unit: 'UND', cost: 1900, rate: 9, season: 'pintura', pack: 50 },
  { sku: 'ALA-GAL', name: 'Alambre galvanizado No. 18', category: 'Ferretería', unit: 'KG', cost: 12400, rate: 2.5, season: 'obra', pack: 10 },

  // Eléctricos
  { sku: 'CAB-12', name: 'Cable eléctrico calibre 12 AWG', category: 'Eléctricos', unit: 'M', cost: 1850, rate: 38, season: 'obra', pack: 100 },
  { sku: 'CAB-14', name: 'Cable eléctrico calibre 14 AWG', category: 'Eléctricos', unit: 'M', cost: 1320, rate: 30, season: 'obra', pack: 100 },
  { sku: 'TOM-DOB', name: 'Tomacorriente doble con polo a tierra', category: 'Eléctricos', unit: 'UND', cost: 7900, rate: 3.5, season: 'obra', pack: 20 },
  { sku: 'INT-SEN', name: 'Interruptor sencillo', category: 'Eléctricos', unit: 'UND', cost: 5600, rate: 3, season: 'obra', pack: 20, low: true },
  { sku: 'BOM-LED9', name: 'Bombillo LED 9 W luz blanca', category: 'Eléctricos', unit: 'UND', cost: 6200, rate: 7, season: 'navidad', pack: 50, growth: 0.15 },
  { sku: 'BOM-LED15', name: 'Bombillo LED 15 W luz blanca', category: 'Eléctricos', unit: 'UND', cost: 9800, rate: 2.5, season: 'navidad', pack: 24, newDays: 46 },
  { sku: 'CIN-AIS', name: 'Cinta aislante 18 m', category: 'Eléctricos', unit: 'UND', cost: 3100, rate: 5, season: 'plana', pack: 20 },
  { sku: 'LUC-NAV', name: 'Instalación de luces navideñas 100 LED', category: 'Eléctricos', unit: 'UND', cost: 18500, rate: 1.4, season: 'navidad', pack: 12 },
  { sku: 'EXT-3M', name: 'Extensión eléctrica 3 m con 3 tomas', category: 'Eléctricos', unit: 'UND', cost: 14500, rate: 1.3, season: 'navidad', pack: 10, noReorder: true },
  { sku: 'BRE-20', name: 'Breaker monopolar 20 A', category: 'Eléctricos', unit: 'UND', cost: 16800, rate: 0.9, season: 'obra', pack: 10 },

  // Plomería
  { sku: 'TUB-PVC1/2', name: 'Tubo PVC presión 1/2" x 6 m', category: 'Plomería', unit: 'UND', cost: 13900, rate: 2.6, season: 'obra', pack: 10 },
  { sku: 'TUB-SAN4', name: 'Tubo PVC sanitario 4" x 6 m', category: 'Plomería', unit: 'UND', cost: 52900, rate: 0.7, season: 'obra', pack: 5 },
  { sku: 'COD-PVC1/2', name: 'Codo PVC 1/2" x 90°', category: 'Plomería', unit: 'UND', cost: 900, rate: 12, season: 'obra', pack: 100 },
  { sku: 'LLA-PASO', name: 'Llave de paso 1/2"', category: 'Plomería', unit: 'UND', cost: 18500, rate: 1.1, season: 'plana', pack: 6 },
  { sku: 'SOL-PVC', name: 'Soldadura PVC 1/4 galón', category: 'Plomería', unit: 'UND', cost: 24900, rate: 0.9, season: 'obra', pack: 6, low: true },
  { sku: 'GRI-LAV', name: 'Grifería lavamanos sencilla', category: 'Plomería', unit: 'UND', cost: 64900, rate: 0.45, season: 'plana', pack: 4 },
  { sku: 'GRI-PRE', name: 'Grifería lavamanos monocontrol premium', category: 'Plomería', unit: 'UND', cost: 245000, rate: 0.06, season: 'plana', pack: 1, stoppedDays: 115 },
  { sku: 'TEF-12', name: 'Cinta teflón 1/2" x 10 m', category: 'Plomería', unit: 'UND', cost: 1500, rate: 8, season: 'plana', pack: 50 },
  { sku: 'SIF-LAV', name: 'Sifón flexible para lavamanos', category: 'Plomería', unit: 'UND', cost: 9900, rate: 1.2, season: 'plana', pack: 10 },

  // Pinturas
  { sku: 'PIN-BLA1', name: 'Pintura vinilo blanco 1 galón', category: 'Pinturas', unit: 'UND', cost: 48900, rate: 2.2, season: 'pintura', pack: 4 },
  { sku: 'PIN-BLA5', name: 'Pintura vinilo blanco 5 galones', category: 'Pinturas', unit: 'UND', cost: 189000, rate: 0.6, season: 'pintura', pack: 1 },
  { sku: 'PIN-ESM1', name: 'Esmalte sintético negro 1 galón', category: 'Pinturas', unit: 'UND', cost: 72500, rate: 0.5, season: 'pintura', pack: 4 },
  { sku: 'BRO-2', name: 'Brocha de 2"', category: 'Pinturas', unit: 'UND', cost: 5400, rate: 3.2, season: 'pintura', pack: 12 },
  { sku: 'ROD-9', name: 'Rodillo de felpa 9"', category: 'Pinturas', unit: 'UND', cost: 15900, rate: 1.5, season: 'pintura', pack: 12, out: true },
  { sku: 'THI-1G', name: 'Thinner corriente', category: 'Pinturas', unit: 'L', cost: 6500, rate: 5, season: 'pintura', pack: 20 },
  { sku: 'EST-PLA', name: 'Estuco plástico interior (cuñete)', category: 'Pinturas', unit: 'UND', cost: 59900, rate: 0.4, season: 'pintura', pack: 2, newDays: 38 },

  // Construcción
  { sku: 'CEM-50', name: 'Cemento gris 50 kg', category: 'Construcción', unit: 'UND', cost: 32500, rate: 11, season: 'obra', pack: 40 },
  { sku: 'ARE-BUL', name: 'Arena de pega por bulto', category: 'Construcción', unit: 'UND', cost: 9500, rate: 9, season: 'obra', pack: 40 },
  { sku: 'BLO-10', name: 'Bloque de arcilla No. 10', category: 'Construcción', unit: 'UND', cost: 1650, rate: 85, season: 'obra', pack: 500 },
  { sku: 'VAR-3/8', name: 'Varilla corrugada 3/8" x 6 m', category: 'Construcción', unit: 'UND', cost: 21900, rate: 6, season: 'obra', pack: 50 },
  { sku: 'MAL-ELE', name: 'Malla electrosoldada 2.35 x 6 m', category: 'Construcción', unit: 'UND', cost: 98000, rate: 0.5, season: 'obra', pack: 5 },
  { sku: 'PEG-BAL', name: 'Pegante para baldosa 25 kg', category: 'Construcción', unit: 'UND', cost: 24900, rate: 2.2, season: 'obra', pack: 20, growth: 0.25 },

  // Cubiertas e impermeabilización
  { sku: 'TEJ-ZIN', name: 'Teja de zinc ondulada 3 m', category: 'Cubiertas e impermeabilización', unit: 'UND', cost: 38900, rate: 2.5, season: 'lluvias', pack: 20 },
  { sku: 'TEJ-PLA', name: 'Teja plástica traslúcida 1.83 m', category: 'Cubiertas e impermeabilización', unit: 'UND', cost: 42900, rate: 0.9, season: 'lluvias', pack: 10 },
  { sku: 'IMP-MAN', name: 'Impermeabilizante manto asfáltico (rollo)', category: 'Cubiertas e impermeabilización', unit: 'UND', cost: 138000, rate: 0.5, season: 'lluvias', pack: 2 },
  { sku: 'IMP-ACR', name: 'Impermeabilizante acrílico 1 galón', category: 'Cubiertas e impermeabilización', unit: 'UND', cost: 54900, rate: 1.1, season: 'lluvias', pack: 4, low: true },
  { sku: 'CAN-PVC', name: 'Canal PVC para agua lluvia 3 m', category: 'Cubiertas e impermeabilización', unit: 'UND', cost: 36500, rate: 0.8, season: 'lluvias', pack: 6 },

  // Jardinería
  { sku: 'MAN-JAR', name: 'Manguera de jardín 15 m', category: 'Jardinería', unit: 'UND', cost: 39900, rate: 0.6, season: 'jardin', pack: 6 },
  { sku: 'TIJ-POD', name: 'Tijera de podar', category: 'Jardinería', unit: 'UND', cost: 28900, rate: 0.4, season: 'jardin', pack: 6 },
  { sku: 'PAL-COR', name: 'Pala cuadrada con cabo', category: 'Jardinería', unit: 'UND', cost: 35900, rate: 0.7, season: 'obra', pack: 6 },
  { sku: 'MAC-24', name: 'Machete 24" con funda', category: 'Jardinería', unit: 'UND', cost: 26900, rate: 0.5, season: 'jardin', pack: 6, noReorder: true },

  // Seguridad industrial
  { sku: 'GUA-NIT', name: 'Guantes de nitrilo (par)', category: 'Seguridad industrial', unit: 'PAQ', cost: 7800, rate: 3.5, season: 'plana', pack: 24, growth: 0.3 },
  { sku: 'GUA-CAR', name: 'Guantes de carnaza (par)', category: 'Seguridad industrial', unit: 'UND', cost: 9900, rate: 2.2, season: 'obra', pack: 24 },
  { sku: 'GAF-SEG', name: 'Gafas de seguridad claras', category: 'Seguridad industrial', unit: 'UND', cost: 6900, rate: 1.8, season: 'plana', pack: 24 },
  { sku: 'CAS-BLA', name: 'Casco de seguridad blanco', category: 'Seguridad industrial', unit: 'UND', cost: 22900, rate: 0.8, season: 'obra', pack: 10 },
  { sku: 'BOT-PVC', name: 'Botas de caucho caña alta', category: 'Seguridad industrial', unit: 'UND', cost: 42900, rate: 0.9, season: 'lluvias', pack: 6, newDays: 60 },
  { sku: 'TAP-AUD', name: 'Tapones auditivos (par)', category: 'Seguridad industrial', unit: 'UND', cost: 1200, rate: 0.3, season: 'plana', pack: 50, inactive: true, stoppedDays: 220 },
];

export const SUPPLIERS = [
  { key: 'nariño', name: 'Ferreteros Unidos de Nariño S.A.S.', taxId: '900481237-5', contact: 'Carlos Benavides', email: 'pedidos@ferreterosnarino.example', phone: '+57 602 731 0145', lead: 2, categories: ['Ferretería', 'Herramientas'] },
  { key: 'electrico', name: 'Distribuidora Eléctrica del Sur', taxId: '901126458-3', contact: 'Paola Ríos', email: 'ventas@electricadelsur.example', phone: '+57 602 485 2210', lead: 4, categories: ['Eléctricos'] },
  { key: 'pinturas', name: 'Pinturas y Recubrimientos Andinos', taxId: '830075219-1', contact: 'Jorge Martínez', email: 'comercial@pinturasandinas.example', phone: '+57 601 744 9031', lead: 6, categories: ['Pinturas'] },
  { key: 'hidro', name: 'Hidrosanitarios del Pacífico Ltda.', taxId: '805031677-8', contact: 'Ana Lucía Ortiz', email: 'despachos@hidropacifico.example', phone: '+57 602 668 4420', lead: 5, categories: ['Plomería'] },
  { key: 'materiales', name: 'Materiales y Agregados Galeras', taxId: '900812345-0', contact: 'Andrés Erazo', email: 'obras@agregadosgaleras.example', phone: '+57 602 729 5566', lead: 2, categories: ['Construcción', 'Cubiertas e impermeabilización'] },
  { key: 'proteccion', name: 'Protección y Campo Integral', taxId: '901377904-6', contact: 'Diana Villota', email: 'servicio@proteccioncampo.example', phone: '+57 604 512 7788', lead: 8, categories: ['Seguridad industrial', 'Jardinería'] },
] as const;

export const WAREHOUSES: { code: WarehouseCode; name: string; address: string }[] = [
  { code: 'PRINCIPAL', name: 'Bodega principal', address: 'Calle 18 # 22-41, Centro, Pasto' },
  { code: 'NORTE', name: 'Bodega Norte', address: 'Avenida Panamericana # 12-80, Pasto' },
  { code: 'SUR', name: 'Punto de venta Sur', address: 'Carrera 4 # 2-15, barrio Santa Bárbara, Pasto' },
];

/** Participación de cada bodega en las ventas. */
const SHARE: Record<WarehouseCode, number> = { PRINCIPAL: 0.5, NORTE: 0.2, SUR: 0.3 };

/** Festivos de Colombia en el rango de la demo. El 25 de diciembre y el 1 de enero no se abre. */
const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-06', '2025-03-24', '2025-04-17', '2025-04-18', '2025-05-01', '2025-06-02', '2025-06-23',
  '2025-06-30', '2025-07-20', '2025-08-07', '2025-08-18', '2025-10-13', '2025-11-03', '2025-11-17', '2025-12-08',
  '2025-12-25', '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18',
  '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25', '2027-01-01', '2027-01-11',
]);
const CLOSED = (day: string) => day.endsWith('-12-25') || day.endsWith('-01-01');

export const HISTORY_DAYS = 548;
/** Días del final en los que se simula el inventario (stock, compras y transferencias). */
export const STOCK_DAYS = 150;

/* ---------------------------------------------------------------- utilidades de fecha */

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const monday = (day: string) => addDays(day, -((dow(day) + 6) % 7));
/** Marca de tiempo en hora de Bogotá. */
export const at = (day: string, hh: number, mm = 0) =>
  `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-05:00`;
const dayOfYear = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
};

/* ---------------------------------------------------------------- azar con semilla */

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  private next: () => number;
  constructor(seed: number) {
    this.next = rng(seed);
  }
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number) {
    return Math.floor(this.float(min, max + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  normal() {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Gamma(k, 1/k): media 1. Da la dispersión extra de las ventas reales. */
  gamma(k: number) {
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = this.normal();
      const v = (1 + c * x) ** 3;
      if (v <= 0) continue;
      if (Math.log(Math.max(this.next(), 1e-12)) < 0.5 * x * x + d - d * v + d * Math.log(v)) return (d * v) / k;
    }
  }
  poisson(lambda: number) {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > limit);
    return k - 1;
  }
}

/* ---------------------------------------------------------------- demanda */

const bump = (doy: number, center: number, width: number) => {
  const d = Math.min(Math.abs(doy - center), 365 - Math.abs(doy - center));
  return Math.exp(-(d * d) / (2 * width * width));
};

/** Factor de temporada de una categoría en un día del año. */
export function seasonFactor(season: Season, day: string): number {
  const doy = dayOfYear(day);
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  switch (season) {
    case 'obra': // vacaciones de fin de año y mitad de año: más obras; en lluvias, menos
      return 1 + 0.28 * bump(doy, 10, 30) + 0.12 * bump(doy, 185, 25) - 0.12 * bump(doy, 115, 25) - 0.12 * bump(doy, 300, 25);
    case 'lluvias': // abril y octubre-noviembre en Pasto
      return 1 + 0.35 * bump(doy, 110, 28) + 0.4 * bump(doy, 300, 30);
    case 'pintura': // se pinta para diciembre
      return 1 + 0.55 * bump(doy, 340, 18) + 0.12 * bump(doy, 170, 15);
    case 'navidad': {
      // De mediados de noviembre a la Nochebuena; casi nada el resto del año.
      const inSeason = (month === 11 && date >= 10) || (month === 12 && date <= 24);
      if (!inSeason) return 0.3;
      const start = month === 11 ? date - 10 : date + 20;
      return 0.6 + 2.6 * Math.min(1, start / 30);
    }
    case 'jardin': // verano de julio-agosto y de enero
      return 1 + 0.5 * bump(doy, 210, 25) + 0.3 * bump(doy, 20, 20);
    case 'herramienta': // día del padre y diciembre
      return 1 + 0.45 * bump(doy, 166, 8) + 0.5 * bump(doy, 350, 12);
    default:
      return 1;
  }
}

const WEEKDAY = [0.35, 0.95, 0.9, 0.95, 1.0, 1.1, 1.45];

export function dayFactor(day: string): number {
  if (CLOSED(day)) return 0;
  const date = Number(day.slice(8, 10));
  const payday = [1, 14, 15, 16, 29, 30, 31].includes(date) ? 1.18 : 1;
  const holiday = HOLIDAYS.has(day) ? 0.45 : 1;
  return WEEKDAY[dow(day)] * payday * holiday;
}

const whole = (unit: Unit) => unit === 'UND' || unit === 'CAJA' || unit === 'PAQ';
const roundQty = (unit: Unit, v: number) => (whole(unit) ? Math.round(v) : Math.round(v * 10) / 10);
const roundPrice = (v: number) => Math.round(v / 100) * 100;

/* ---------------------------------------------------------------- resultado */

export interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  unit: Unit;
  cost: number;
  price: number;
  isActive: boolean;
  createdDaysAgo: number;
  reorderPoint: number | null;
  safetyStock: number | null;
  supplier: string;
  description: string | null;
}

export interface DemoSale {
  sku: string;
  warehouse: WarehouseCode;
  day: string;
  qty: number;
  price: number;
}

export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'PURCHASE_RECEIPT';

export interface DemoMovement {
  sku: string;
  warehouse: WarehouseCode;
  at: string;
  type: MovementType;
  qty: number;
  balance: number;
  /** Puede llevar {ref}: se cambia por el código de la orden, transferencia o conteo. */
  reason: string;
  ref?: { kind: 'purchase_order' | 'transfer' | 'stock_count'; key: string };
  user: DemoUser;
}

export interface DemoOrder {
  key: string;
  supplier: string;
  status: 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  createdAt: string;
  sentAt: string | null;
  expectedAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  lines: { sku: string; qty: number; cost: number; received: number }[];
  receipts: { day: string; at: string; leadDays: number; notes: string | null; lines: { sku: string; qty: number }[] }[];
}

export interface DemoTransfer {
  key: string;
  from: WarehouseCode;
  to: WarehouseCode;
  status: 'PENDING' | 'RECEIVED';
  createdAt: string;
  receivedAt: string | null;
  notes: string | null;
  lines: { sku: string; qty: number }[];
}

export interface DemoCount {
  key: string;
  warehouse: WarehouseCode;
  status: 'SUBMITTED' | 'APPROVED';
  createdAt: string;
  submittedAt: string;
  reviewedAt: string | null;
  notes: string;
  reviewNotes: string | null;
  lines: { sku: string; system: number; counted: number }[];
}

export interface DemoAlert {
  sku: string;
  status: 'OPEN' | 'SEEN' | 'RESOLVED';
  openedAt: string;
  stockAtOpen: number;
  current: number;
  reorderPoint: number;
  seenAt: string | null;
  resolvedAt: string | null;
}

export interface DemoData {
  today: string;
  products: DemoProduct[];
  sales: DemoSale[];
  movements: DemoMovement[];
  stock: { sku: string; warehouse: WarehouseCode; qty: number }[];
  orders: DemoOrder[];
  transfers: DemoTransfer[];
  counts: DemoCount[];
  alerts: DemoAlert[];
  /** La semana (lunes) donde se sembraron los casos raros. */
  anomalyWeek: string;
}

/* ---------------------------------------------------------------- generación */

const CODES: WarehouseCode[] = ['PRINCIPAL', 'NORTE', 'SUR'];

/**
 * @param today día de hoy en Bogotá (AAAA-MM-DD). La historia termina ayer.
 */
export function generateDemo(today: string, seed = 20261105): DemoData {
  const r = new Random(seed);
  const yesterday = addDays(today, -1);
  const first = addDays(today, -HISTORY_DAYS);
  const stockStart = addDays(today, -STOCK_DAYS);
  // Semana de los casos raros: la última semana completa.
  const anomalyWeek = addDays(monday(today), -7);

  const supplierOf = (category: string) => SUPPLIERS.find((s) => (s.categories as readonly string[]).includes(category))!;

  // 1. Demanda diaria por producto y bodega (lo que la gente quería comprar).
  type Demand = Record<WarehouseCode, number[]>;
  const days: string[] = [];
  for (let d = first; d <= yesterday; d = addDays(d, 1)) days.push(d);
  const indexOf = new Map(days.map((d, i) => [d, i]));
  const demand = new Map<string, Demand>();
  const priceHistory = new Map<string, (day: string) => number>();

  for (const item of CATALOG) {
    const startIndex = item.newDays ? days.length - item.newDays : 0;
    const stopIndex = item.stoppedDays ? days.length - item.stoppedDays : days.length;
    const storeBias: Record<WarehouseCode, number> = { PRINCIPAL: r.float(0.9, 1.1), NORTE: r.float(0.8, 1.2), SUR: r.float(0.8, 1.2) };
    const growth = item.growth ?? r.float(-0.05, 0.1);
    const series: Demand = { PRINCIPAL: [], NORTE: [], SUR: [] };
    days.forEach((day, i) => {
      const years = (i - days.length) / 365; // 0 hoy, negativo hacia atrás
      // Un producto nuevo arranca suave las primeras semanas mientras la gente lo conoce.
      const ramp = item.newDays ? Math.min(1, (i - startIndex + 7) / 28) : 1;
      const mean = i < startIndex || i >= stopIndex ? 0 : item.rate * seasonFactor(item.season, day) * dayFactor(day) * (1 + growth * years) * ramp;
      for (const w of CODES) {
        const lambda = mean * SHARE[w] * storeBias[w];
        if (lambda <= 0) {
          series[w].push(0);
          continue;
        }
        const noisy = lambda * r.gamma(whole(item.unit) ? 5 : 3);
        // Las unidades que se cortan (metros, kilos, litros) se venden en fracciones.
        const qty = whole(item.unit) ? r.poisson(noisy) : r.chance(Math.min(0.95, 0.15 + lambda / 4)) ? roundQty(item.unit, noisy * r.float(0.8, 1.6)) : 0;
        series[w].push(qty);
      }
    });
    demand.set(item.sku, series);
    // Precio de venta: margen por producto y un ajuste del 6 % en enero de 2026.
    const margin = r.float(1.28, 1.6);
    const base = roundPrice(item.cost * margin * 0.94);
    priceHistory.set(item.sku, (day) => (day >= '2026-01-13' ? roundPrice(base * 1.06) : base));
  }

  // Casos raros sembrados en la última semana completa (HU-26):
  //  1. Pintura vinilo 1 galón: jueves y viernes con ventas de promoción.
  //  2. Chazo plástico: un miércoles con 30 veces lo normal (parece error de digitación).
  //  3. Cemento: la merma va en los movimientos (más abajo).
  const paint = demand.get('PIN-BLA1')!;
  const iThu = indexOf.get(addDays(anomalyWeek, 3));
  const iFri = indexOf.get(addDays(anomalyWeek, 4));
  const iWed = indexOf.get(addDays(anomalyWeek, 2));
  if (iThu !== undefined && iFri !== undefined && iWed !== undefined) {
    paint.PRINCIPAL[iThu] += 9;
    paint.PRINCIPAL[iFri] += 11;
    paint.SUR[iFri] += 4;
  }

  // 2. Inventario de los últimos STOCK_DAYS días.
  const stockIndex = indexOf.get(stockStart)!;
  const avgDaily = (sku: string) => {
    const s = demand.get(sku)!;
    let total = 0;
    for (let i = days.length - 90; i < days.length; i++) for (const w of CODES) total += s[w][i];
    return total / 90;
  };
  const sales: DemoSale[] = [];
  const movements: DemoMovement[] = [];
  const orders: DemoOrder[] = [];
  const transfers: DemoTransfer[] = [];
  const counts: DemoCount[] = [];
  const alerts: DemoAlert[] = [];
  const products: DemoProduct[] = [];

  const stock = new Map<string, Record<WarehouseCode, number>>();
  const policy = new Map<string, { avg: number; lead: number; reorder: number; safety: number; pack: number }>();
  for (const item of CATALOG) {
    const supplier = supplierOf(item.category);
    // Con historia corta, el promedio se toma sobre los días que lleva a la venta.
    const avg = item.newDays ? (avgDaily(item.sku) * 90) / Math.min(90, item.newDays) : avgDaily(item.sku);
    const safety = roundQty(item.unit, Math.ceil(avg * 3));
    const reorder = roundQty(item.unit, Math.ceil(avg * supplier.lead + safety));
    policy.set(item.sku, { avg, lead: supplier.lead, reorder, safety, pack: item.pack ?? 1 });
    stock.set(item.sku, { PRINCIPAL: 0, NORTE: 0, SUR: 0 });
  }

  // Ventas del día aún sin registrar en el kardex: se registran en una salida semanal.
  const pending = new Map<string, number>();
  const pend = (sku: string, w: WarehouseCode) => pending.get(`${sku}|${w}`) ?? 0;
  /** Lo que de verdad hay en la bodega (el kardex menos lo vendido esta semana). */
  const onHand = (sku: string, w: WarehouseCode) => stock.get(sku)![w] - pend(sku, w);
  const move = (sku: string, w: WarehouseCode, time: string, type: MovementType, qty: number, reason: string, user: DemoUser, ref?: DemoMovement['ref']) => {
    const item = CATALOG.find((c) => c.sku === sku)!;
    const s = stock.get(sku)!;
    const q = roundQty(item.unit, qty);
    if (q === 0) return;
    s[w] = roundQty(item.unit, s[w] + q);
    movements.push({ sku, warehouse: w, at: time, type, qty: q, balance: 0, reason, ref, user });
  };

  // Ventas anteriores a la simulación de stock: tal cual la demanda.
  for (const item of CATALOG) {
    const series = demand.get(item.sku)!;
    const price = priceHistory.get(item.sku)!;
    for (let i = 0; i < stockIndex; i++) {
      for (const w of CODES) if (series[w][i] > 0) sales.push({ sku: item.sku, warehouse: w, day: days[i], qty: series[w][i], price: price(days[i]) });
    }
  }

  // Inventario inicial: cinco semanas de demanda en la principal y tres en cada sucursal.
  for (const item of CATALOG) {
    if (item.inactive) continue;
    const p = policy.get(item.sku)!;
    const created = item.newDays ? addDays(today, -item.newDays) : stockStart;
    const initDay = created < stockStart ? stockStart : created;
    const base = Math.max(p.avg, whole(item.unit) ? 0.3 : 1);
    const target: Record<WarehouseCode, number> = {
      PRINCIPAL: Math.max(p.reorder * 2, base * 35 * SHARE.PRINCIPAL + base * 20),
      NORTE: base * 21 * SHARE.NORTE,
      SUR: base * 21 * SHARE.SUR,
    };
    if (item.stoppedDays) {
      target.PRINCIPAL = whole(item.unit) ? r.int(3, 6) : 20;
      target.NORTE = whole(item.unit) ? 1 : 0;
      target.SUR = 0;
    }
    for (const w of CODES) {
      const q = whole(item.unit) ? Math.max(1, Math.ceil(target[w])) : Math.ceil(target[w]);
      move(item.sku, w, at(initDay, 7, 30), 'IN', q, 'Inventario inicial', 'admin');
    }
  }

  const pendingReceipts: { order: DemoOrder; day: string; part: number }[] = [];
  let orderSeq = 0;
  let transferSeq = 0;
  const onOrder = (sku: string) =>
    orders.filter((o) => o.status === 'SENT' || o.status === 'PARTIALLY_RECEIVED').reduce((t, o) => t + o.lines.filter((l) => l.sku === sku).reduce((x, l) => x + l.qty - l.received, 0), 0);
  const total = (sku: string) => onHand(sku, 'PRINCIPAL') + onHand(sku, 'NORTE') + onHand(sku, 'SUR');
  const exists = (item: CatalogItem, daysLeft: number) => !item.inactive && !(item.newDays && daysLeft > item.newDays);
  const openAlerts = new Map<string, DemoAlert>();

  for (let i = stockIndex; i < days.length; i++) {
    const day = days[i];
    const daysLeft = days.length - i;
    const weekday = dow(day);

    // a. Recepciones que llegan hoy.
    for (const pr of pendingReceipts.filter((x) => x.day === day)) {
      const o = pr.order;
      const lines = o.lines.map((l) => {
        const pending = l.qty - l.received;
        const qty = pr.part < 1 ? roundQty(CATALOG.find((c) => c.sku === l.sku)!.unit, Math.floor(pending * pr.part)) : pending;
        return { sku: l.sku, qty };
      }).filter((l) => l.qty > 0);
      const time = at(day, r.int(8, 10), r.int(0, 59));
      const lead = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${o.sentAt!.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
      o.receipts.push({ day, at: time, leadDays: lead, notes: pr.part < 1 ? 'Llegó una parte; el proveedor despacha el resto la otra semana' : null, lines });
      for (const l of lines) {
        o.lines.find((x) => x.sku === l.sku)!.received += l.qty;
        move(l.sku, 'PRINCIPAL', time, 'PURCHASE_RECEIPT', l.qty, 'Recepción de {ref}', 'bruno', { kind: 'purchase_order', key: o.key });
      }
      const complete = o.lines.every((l) => l.received >= l.qty);
      o.status = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      if (complete) o.receivedAt = time;
    }

    // b. Ventas del día: solo se vende lo que hay en la bodega.
    for (const item of CATALOG) {
      const series = demand.get(item.sku)!;
      const price = priceHistory.get(item.sku)!(day);
      for (const w of CODES) {
        const want = series[w][i];
        if (want <= 0) continue;
        const sold = roundQty(item.unit, Math.min(want, Math.max(0, onHand(item.sku, w))));
        if (sold <= 0) continue;
        sales.push({ sku: item.sku, warehouse: w, day, qty: sold, price });
        const k = `${item.sku}|${w}`;
        pending.set(k, roundQty(item.unit, (pending.get(k) ?? 0) + sold));
      }
    }

    // c. Cierre de semana (sábado) o fin de la historia: una salida por las ventas de la semana.
    if (weekday === 6 || i === days.length - 1) {
      for (const [k, qty] of pending) {
        const [sku, w] = k.split('|') as [string, WarehouseCode];
        if (qty > 0) move(sku, w, at(day, 19, 10), 'OUT', -qty, 'Ventas de la semana (importadas del punto de venta)', 'bruno');
      }
      pending.clear();
    }

    // d. Alertas: se abren al caer bajo el punto de reorden y se resuelven al reponer.
    for (const item of CATALOG) {
      if (item.inactive || item.noReorder) continue;
      const p = policy.get(item.sku)!;
      const t = total(item.sku);
      const open = openAlerts.get(item.sku);
      if (!open && t <= p.reorder) {
        const a: DemoAlert = { sku: item.sku, status: 'OPEN', openedAt: at(day, 18, 0), stockAtOpen: t, current: t, reorderPoint: p.reorder, seenAt: null, resolvedAt: null };
        openAlerts.set(item.sku, a);
        alerts.push(a);
      } else if (open) {
        open.current = t;
        if (t > p.reorder) {
          open.status = 'RESOLVED';
          open.resolvedAt = at(day, 16, 0);
          open.seenAt ??= at(addDays(open.openedAt.slice(0, 10), 1), 8, 40);
          openAlerts.delete(item.sku);
        }
      }
    }

    // e. Lunes: pedidos a los proveedores (revisión semanal).
    if (weekday === 1) {
      for (const supplier of SUPPLIERS) {
        const lines: DemoOrder['lines'] = [];
        for (const item of CATALOG.filter((c) => (supplier.categories as readonly string[]).includes(c.category))) {
          if (!exists(item, daysLeft) || item.stoppedDays) continue;
          if ((item.low && daysLeft < 30) || (item.out && daysLeft < 85)) continue; // se dejan bajar a propósito
          const p = policy.get(item.sku)!;
          const position = total(item.sku) + onOrder(item.sku);
          // Revisión semanal: se pide si lo que hay y lo que viene no alcanza para tres semanas
          // más el tiempo de entrega; se pide para unas seis semanas y media.
          if (position > p.reorder + p.avg * 21) continue;
          const want = p.avg * (p.lead + 45) + p.safety - position;
          const qty = Math.max(p.pack, Math.ceil(want / p.pack) * p.pack);
          const cost = roundPrice(item.cost * r.float(0.97, 1.02));
          lines.push({ sku: item.sku, qty, cost, received: 0 });
        }
        if (!lines.length) continue;
        orderSeq++;
        const created = at(addDays(day, -1), 17, r.int(0, 50));
        const sent = at(day, 9, r.int(0, 45));
        const o: DemoOrder = {
          key: `OC${orderSeq}`, supplier: supplier.key, status: 'SENT', createdAt: created, sentAt: sent,
          expectedAt: addDays(day, supplier.lead), receivedAt: null, cancelledAt: null, notes: null, lines, receipts: [],
        };
        orders.push(o);
        const delay = supplier.lead + r.pick([-1, 0, 0, 0, 1, 1, 2]);
        const arrival = addDays(day, Math.max(1, delay));
        if (r.chance(0.12) && lines.length > 1) {
          pendingReceipts.push({ order: o, day: arrival, part: 0.6 });
          pendingReceipts.push({ order: o, day: addDays(arrival, r.int(3, 6)), part: 1 });
        } else pendingReceipts.push({ order: o, day: arrival, part: 1 });
      }
    }

    // f. Martes y viernes: transferencias de la principal a las sucursales.
    if ((weekday === 2 || weekday === 5) && daysLeft > 1) {
      for (const to of ['NORTE', 'SUR'] as const) {
        const lines: { sku: string; qty: number }[] = [];
        for (const item of CATALOG) {
          if (!exists(item, daysLeft) || item.stoppedDays) continue;
          const p = policy.get(item.sku)!;
          const branchDaily = p.avg * SHARE[to];
          const there = onHand(item.sku, to);
          if (there > branchDaily * 8) continue;
          const keep = p.avg * SHARE.PRINCIPAL * 7;
          const qty = roundQty(item.unit, Math.min(branchDaily * 21 - there, onHand(item.sku, 'PRINCIPAL') - keep));
          if (qty >= (whole(item.unit) ? 1 : 1)) lines.push({ sku: item.sku, qty: whole(item.unit) ? Math.ceil(qty) : qty });
        }
        if (!lines.length) continue;
        transferSeq++;
        const key = `TR${transferSeq}`;
        const sent = at(day, 11, r.int(0, 50));
        const arrived = at(day, r.int(13, 15), r.int(0, 59));
        const toName = WAREHOUSES.find((w) => w.code === to)!.name;
        for (const l of lines) move(l.sku, 'PRINCIPAL', sent, 'TRANSFER_OUT', -l.qty, `Transferencia {ref} hacia ${toName}`, 'bruno', { kind: 'transfer', key });
        for (const l of lines) move(l.sku, to, arrived, 'TRANSFER_IN', l.qty, 'Transferencia {ref} desde Bodega principal', 'bruno', { kind: 'transfer', key });
        transfers.push({ key, from: 'PRINCIPAL', to, status: 'RECEIVED', createdAt: sent, receivedAt: arrived, notes: null, lines });
      }
    }

    // g. Movimientos sueltos que pasan en cualquier ferretería.
    if (r.chance(0.25)) {
      const item = r.pick(CATALOG.filter((c) => exists(c, daysLeft) && !c.stoppedDays && whole(c.unit)));
      const w = r.pick(CODES);
      const there = onHand(item.sku, w);
      if (there > 3) {
        const kind = r.pick(['interno', 'obra', 'devolucion'] as const);
        const time = at(day, r.int(16, 17), r.int(0, 59));
        if (kind === 'interno') move(item.sku, w, time, 'OUT', -1, 'Consumo interno: mantenimiento del local', 'bruno');
        else if (kind === 'obra') move(item.sku, w, time, 'OUT', -Math.min(there - 1, r.int(2, 6)), 'Despacho a obra de cliente con crédito', 'bruno');
        else move(item.sku, w, time, 'IN', 1, 'Devolución de cliente en buen estado', 'bruno');
      }
    }
    // Los productos «bajos» terminan bajo su punto de reorden: un despacho grande a una obra
    // se lleva buena parte del stock nueve días antes de hoy y todavía no se ha repuesto.
    if (daysLeft === 9) {
      for (const item of CATALOG.filter((c) => c.low)) {
        const p = policy.get(item.sku)!;
        const goal = p.reorder * 0.45 + p.avg * 6;
        const extra = roundQty(item.unit, Math.min(total(item.sku) - goal, onHand(item.sku, 'PRINCIPAL')));
        if (extra > 0) move(item.sku, 'PRINCIPAL', at(day, 10, 40), 'OUT', -extra, 'Despacho a obra: pedido grande de una constructora', 'bruno');
      }
    }
    // Una merma vieja (fuera de la ventana de anomalías) para que haya historia.
    if (daysLeft === 96) move('BLO-10', 'PRINCIPAL', at(day, 10, 15), 'OUT', -24, 'Producto dañado: bloques quebrados en el descargue', 'bruno');
    if (daysLeft === 71) move('PIN-BLA1', 'SUR', at(day, 16, 5), 'OUT', -1, 'Producto vencido: galón endurecido', 'bruno');

    // h. La merma del caso raro: bultos de cemento mojados (jueves de la semana sembrada).
    if (day === addDays(anomalyWeek, 3)) {
      const q = Math.min(Math.max(1, onHand('CEM-50', 'PRINCIPAL') - 2), 28);
      move('CEM-50', 'PRINCIPAL', at(day, 15, 20), 'OUT', -q, 'Producto dañado: bultos mojados por una gotera', 'bruno');
    }

    // i. Conteo físico aprobado hace 5 semanas en la Bodega Norte.
    if (daysLeft === 35) {
      const picked = ['MAR-016', 'FLE-5M', 'TOR-DRY6', 'CIN-AIS', 'GUA-NIT', 'BRO-2', 'TOM-DOB', 'BIS-3'];
      const diffs: Record<string, number> = { 'CIN-AIS': -2, 'BIS-3': 3, 'GUA-NIT': -1 };
      const lines = picked.map((sku) => {
        const system = onHand(sku, 'NORTE');
        return { sku, system, counted: Math.max(0, system + (diffs[sku] ?? 0)) };
      });
      const key = 'CF1';
      counts.push({
        key, warehouse: 'NORTE', status: 'APPROVED', createdAt: at(day, 7, 40), submittedAt: at(day, 11, 25), reviewedAt: at(day, 15, 5),
        notes: 'Conteo de rotación alta, estantes 1 a 4', reviewNotes: 'Diferencias revisadas con Bruno; las bisagras estaban en otra caja',
        lines,
      });
      for (const l of lines) if (l.counted !== l.system) move(l.sku, 'NORTE', at(day, 15, 5), 'ADJUSTMENT', l.counted - l.system, 'Conteo físico', 'admin', { kind: 'stock_count', key });
    }
  }

  // 3. Estado de hoy: órdenes abiertas para el final de la demo.
  // Las órdenes que todavía no llegan quedan en camino (SENT o recibidas en parte).
  // Una transferencia que salió ayer hacia el Sur y todavía no llega.
  {
    const lines = ['TEF-12', 'CIN-AIS', 'GUA-CAR', 'SIF-LAV']
      .map((sku) => ({ sku, qty: Math.floor(Math.min(onHand(sku, 'PRINCIPAL') / 4, policy.get(sku)!.avg * 4)) }))
      .filter((l) => l.qty > 0);
    if (lines.length) {
      transferSeq++;
      const key = `TR${transferSeq}`;
      const sent = at(yesterday, 17, 35);
      for (const l of lines) move(l.sku, 'PRINCIPAL', sent, 'TRANSFER_OUT', -l.qty, 'Transferencia {ref} hacia Punto de venta Sur', 'bruno', { kind: 'transfer', key });
      transfers.push({ key, from: 'PRINCIPAL', to: 'SUR', status: 'PENDING', createdAt: sent, receivedAt: null, notes: 'Va en el camión de la mañana', lines });
    }
  }

  const draftLines = CATALOG.filter((c) => c.low).map((c) => {
    const p = policy.get(c.sku)!;
    return { sku: c.sku, qty: Math.max(p.pack, Math.ceil((p.avg * (p.lead + 45)) / p.pack) * p.pack), cost: c.cost, received: 0 };
  });
  // Un borrador por proveedor de los productos que quedaron bajos (Marta los está preparando).
  for (const supplier of SUPPLIERS) {
    const lines = draftLines.filter((l) => supplierOf(CATALOG.find((c) => c.sku === l.sku)!.category).key === supplier.key);
    if (!lines.length) continue;
    orderSeq++;
    // La de eléctricos ya salió hace dos días; las demás siguen en borrador.
    const sent = supplier.key === 'electrico';
    orders.push({
      key: `OC${orderSeq}`, supplier: supplier.key, status: sent ? 'SENT' : 'DRAFT', createdAt: at(addDays(today, sent ? -3 : -1), 16, 30),
      sentAt: sent ? at(addDays(today, -2), 9, 10) : null, expectedAt: addDays(today, sent ? supplier.lead - 2 : supplier.lead + 1),
      receivedAt: null, cancelledAt: null, notes: 'Reposición de lo que quedó bajo el punto de reorden', lines, receipts: [],
    });
  }
  // Una orden cancelada para que se vea el estado.
  orderSeq++;
  orders.push({
    key: `OC${orderSeq}`, supplier: 'proteccion', status: 'CANCELLED', createdAt: at(addDays(today, -20), 10, 0), sentAt: null,
    expectedAt: addDays(today, -12), receivedAt: null, cancelledAt: at(addDays(today, -19), 9, 15), notes: 'Se canceló: el proveedor subió el precio de las botas',
    lines: [{ sku: 'BOT-PVC', qty: 24, cost: 46900, received: 0 }], receipts: [],
  });

  // Conteo enviado esta semana en el punto Sur, pendiente de aprobación.
  const countLines = ['CEM-50', 'ARE-BUL', 'VAR-3/8', 'PEG-BAL', 'TEJ-ZIN'].map((sku) => {
    const system = onHand(sku, 'SUR');
    return { sku, system, counted: Math.max(0, system + (sku === 'ARE-BUL' ? -2 : sku === 'TEJ-ZIN' ? 1 : 0)) };
  });
  counts.push({
    key: 'CF2', warehouse: 'SUR', status: 'SUBMITTED', createdAt: at(yesterday, 7, 50), submittedAt: at(yesterday, 10, 40), reviewedAt: null,
    notes: 'Conteo del patio de materiales', reviewNotes: null, lines: countLines,
  });

  // Una alerta ya vista por Marta (ya pidió).
  const seen = alerts.filter((a) => a.status === 'OPEN')[0];
  if (seen) {
    seen.status = 'SEEN';
    seen.seenAt = at(yesterday, 9, 5);
  }
  for (const a of alerts.filter((x) => x.status !== 'RESOLVED')) a.current = total(a.sku);

  for (const item of CATALOG) {
    const p = policy.get(item.sku)!;
    products.push({
      sku: item.sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      cost: item.cost,
      price: priceHistory.get(item.sku)!(today),
      isActive: !item.inactive,
      createdDaysAgo: item.newDays ?? 600,
      reorderPoint: item.noReorder || item.inactive ? null : p.reorder,
      safetyStock: item.noReorder || item.inactive ? null : Math.min(p.safety, p.reorder),
      supplier: supplierOf(item.category).key,
      description: item.description ?? null,
    });
  }

  const finalStock: DemoData['stock'] = [];
  for (const item of CATALOG) {
    if (item.inactive) continue;
    const s = stock.get(item.sku)!;
    for (const w of CODES) finalStock.push({ sku: item.sku, warehouse: w, qty: s[w] });
  }

  // Error de digitación en la importación de ventas (no movió el inventario): un miércoles
  // del chazo plástico con 30 veces lo normal.
  const typo = addDays(anomalyWeek, 2);
  const row = sales.find((x) => x.sku === 'CHA-3/8' && x.warehouse === 'PRINCIPAL' && x.day === typo);
  if (row) row.qty += 120;
  else sales.push({ sku: 'CHA-3/8', warehouse: 'PRINCIPAL', day: typo, qty: 120, price: priceHistory.get('CHA-3/8')!(typo) });

  // Saldos del kardex en orden cronológico (los movimientos del mismo día se generan en
  // otro orden que su hora).
  movements.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const running = new Map<string, number>();
  for (const m of movements) {
    const k = `${m.sku}|${m.warehouse}`;
    const unit = CATALOG.find((c) => c.sku === m.sku)!.unit;
    const next = roundQty(unit, (running.get(k) ?? 0) + m.qty);
    if (next < 0) throw new Error(`Saldo negativo en ${k} el ${m.at}`);
    running.set(k, next);
    m.balance = next;
  }
  for (const s of finalStock) {
    if ((running.get(`${s.sku}|${s.warehouse}`) ?? 0) !== s.qty) throw new Error(`El saldo de ${s.sku} en ${s.warehouse} no cuadra`);
  }
  return { today, products, sales, movements, stock: finalStock, orders, transfers, counts, alerts, anomalyWeek };
}
