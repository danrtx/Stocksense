import { computeSuggestion } from './suggestions.service';

describe('T-17.1 · Fórmula de reposición', () => {
  const base = {
    weekly: Array(12).fill(14), // 2 por día
    firstWeek: '2026-10-12',
    today: '2026-10-14',
    leadTimeDays: 7,
    onHand: 10,
    inTransit: 0,
    onOrder: 0,
    safetyStock: 5,
    unit: 'UND',
  };

  it('pide lo que falta para cubrir entrega + revisión + seguridad', () => {
    const r = computeSuggestion(base);
    // demanda en 7 + 7 días = 28; objetivo 28 + 5 = 33; posición 10 → 23
    expect(r).toMatchObject({ demandLeadReview: 28, target: 33, position: 10, quantity: 23, urgency: 'NOW', orderBy: '2026-10-14' });
    expect(r.stockoutDate).toBe('2026-10-19');
  });

  it('cuenta lo que ya está pedido o en camino y avisa con tiempo', () => {
    const r = computeSuggestion({ ...base, onHand: 30, onOrder: 0 });
    // 30 − 2·(t+7) < 5 → t ≥ 6 → pedir el 20 de octubre
    expect(r).toMatchObject({ quantity: 3, urgency: 'WEEK', orderBy: '2026-10-20', daysUntilOrder: 6 });
    expect(computeSuggestion({ ...base, onOrder: 40 }).quantity).toBe(0);
  });

  it('redondea hacia arriba en unidades enteras y a un decimal en las demás', () => {
    expect(computeSuggestion({ ...base, weekly: Array(12).fill(10) }).quantity).toBe(15); // 20 + 5 − 10
    expect(computeSuggestion({ ...base, unit: 'KG', weekly: Array(12).fill(10.15) }).quantity).toBe(15.3);
  });

  it('sin demanda no sugiere nada', () => {
    expect(computeSuggestion({ ...base, weekly: Array(12).fill(0), safetyStock: 0 })).toMatchObject({ quantity: 0, urgency: 'NONE' });
  });
});
