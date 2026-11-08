import { CATALOG, addDays, generateDemo, monday } from './demo-data';

describe('Datos de demostración', () => {
  const today = '2026-11-05';
  const data = generateDemo(today);

  it('salen iguales cada vez (semilla fija)', () => {
    const again = generateDemo(today);
    expect(again.sales.length).toBe(data.sales.length);
    expect(again.movements.slice(0, 50)).toEqual(data.movements.slice(0, 50));
  });

  it('el kardex cuadra: cada saldo es el anterior más la cantidad y nunca es negativo', () => {
    const last = new Map<string, number>();
    for (const m of data.movements) {
      const key = `${m.sku}|${m.warehouse}`;
      const prev = last.get(key) ?? 0;
      expect(m.balance).toBeCloseTo(prev + m.qty, 3);
      expect(m.balance).toBeGreaterThanOrEqual(0);
      last.set(key, m.balance);
    }
    for (const s of data.stock) expect(last.get(`${s.sku}|${s.warehouse}`) ?? 0).toBeCloseTo(s.qty, 3);
  });

  it('las ventas llegan hasta ayer y no hay ventas sin stock en los últimos 150 días', () => {
    const lastDay = data.sales.reduce((m, s) => (s.day > m ? s.day : m), '');
    expect(lastDay).toBe(addDays(today, -1));
    expect(data.sales.every((s) => s.qty > 0 && s.price > 0)).toBe(true);
  });

  it('deja productos bajo el punto de reorden, agotados y quietos para la demo', () => {
    const total = (sku: string) => data.stock.filter((s) => s.sku === sku).reduce((t, s) => t + s.qty, 0);
    const below = data.products.filter((p) => p.isActive && p.reorderPoint != null && total(p.sku) <= p.reorderPoint);
    expect(below.length).toBeGreaterThanOrEqual(4);
    expect(below.length).toBeLessThanOrEqual(12);
    expect(data.products.filter((p) => p.reorderPoint == null && p.isActive).length).toBe(3);
    expect(data.alerts.filter((a) => a.status !== 'RESOLVED').map((a) => a.sku).sort()).toEqual(below.map((p) => p.sku).sort());
    const stopped = CATALOG.filter((c) => c.stoppedDays && !c.inactive).map((c) => c.sku);
    const recent = addDays(today, -90);
    for (const sku of stopped) expect(data.movements.some((m) => m.sku === sku && m.at.slice(0, 10) >= recent)).toBe(false);
  });

  it('siembra los tres casos raros en la última semana completa', () => {
    const week = addDays(monday(today), -7);
    expect(data.anomalyWeek).toBe(week);
    const weekSales = (sku: string, from: string) =>
      data.sales.filter((s) => s.sku === sku && s.day >= from && s.day < addDays(from, 7)).reduce((t, s) => t + s.qty, 0);
    expect(weekSales('CHA-3/8', week)).toBeGreaterThan(3 * weekSales('CHA-3/8', addDays(week, -14)));
    expect(weekSales('PIN-BLA1', week)).toBeGreaterThan(2 * weekSales('PIN-BLA1', addDays(week, -14)));
    expect(data.movements.some((m) => m.sku === 'CEM-50' && m.at.startsWith(addDays(week, 3)) && /dañado/.test(m.reason))).toBe(true);
  });

  it('las órdenes y transferencias tienen sus estados de demo', () => {
    const statuses = new Set(data.orders.map((o) => o.status));
    for (const s of ['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED']) expect(statuses.has(s as never)).toBe(true);
    expect(data.transfers.some((t) => t.status === 'PENDING')).toBe(true);
    expect(data.counts.map((c) => c.status).sort()).toEqual(['APPROVED', 'SUBMITTED']);
    for (const o of data.orders.filter((x) => x.status === 'RECEIVED')) {
      for (const l of o.lines) expect(l.received).toBe(l.qty);
    }
  });
});
