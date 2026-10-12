import { buildFacts, validateExplanation } from './explain.service';
import { numbersInText, unknownNumbers, wordCount } from './number-check';

describe('T-24.2 · Validador de cifras', () => {
  const data = { forecastTotal: 1234.5, trendPct: -16, horizonWeeks: 4, week: '2026-10-19', product: { sku: 'MAR-001', name: 'Tubo 1/2' } };

  it('lee números en formato colombiano e inglés', () => {
    expect(numbersInText('1.234,5 unidades y 12,5 %')[0].candidates).toContain(1234.5);
    expect(numbersInText('12,5 %')[0].candidates).toContain(12.5);
    expect(numbersInText('1,234.5')[0].candidates).toContain(1234.5);
  });

  it('acepta cifras de los datos, sus redondeos y partes de fechas o nombres', () => {
    expect(unknownNumbers('Se esperan 1.234,5 UND (unas 1.235) en 4 semanas, 16 % menos.', data)).toEqual([]);
    expect(unknownNumbers('Desde el 19 de octubre de 2026, el tubo de 1/2 y MAR-001.', data)).toEqual([]);
  });

  it('rechaza cifras que no están en los datos', () => {
    expect(unknownNumbers('Vas a vender 937 unidades, un 25 % más.', data)).toEqual(['937', '25']);
  });

  it('cuenta palabras y valida el formato completo', () => {
    expect(wordCount('Se esperan 12 UND · bien')).toBe(5);
    expect(() => validateExplanation('no es json', data)).toThrow('formato esperado');
    expect(() => validateExplanation(JSON.stringify({ tendencia: 'a', estacionalidad: '', advertencias: 'c' }), data)).toThrow('faltó');
    const ok = validateExplanation(JSON.stringify({ tendencia: 'Baja 16 %.', estacionalidad: 'Sin datos.', advertencias: 'No hay.' }), data);
    expect(ok.tendencia).toBe('Baja 16 %.');
  });

  it('arma los datos con tendencia, estacionalidad y advertencias calculadas', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({ week: `w${i}`, quantity: i % 5 === 0 ? 0 : 10 }));
    const facts = buildFacts(
      {
        product: { id: 'p', sku: 'X', name: 'X', unit: 'UND', category: 'C' },
        status: 'READY',
        message: null,
        weeksOfHistory: 60,
        horizonWeeks: 2,
        history,
        forecast: [
          { week: '2026-10-12', step: 1, yhat: 9, lo: 1, hi: 30 },
          { week: '2026-10-19', step: 2, yhat: 11, lo: 2, hi: 40 },
        ],
        model: {
          runId: 'r', version: 1, trainedAt: '', dataLastWeek: null, method: 'SES', methodLabel: 'SES', params: {},
          testWape: 0.7, testBias: 0, baselineWape: 0.6, beatsBaseline: false, testWeeks: 13, flagged: true,
        },
      },
      0.5,
      [{ week: 'a', quantity: 20 }, { week: 'b', quantity: 20 }],
    );
    expect(facts.forecastTotal).toBe(20);
    expect(facts.seasonalityPct).toBe(148); // 20 por semana contra un promedio anual de 8,08
    expect(facts.zeroWeeksLast12).toBe(2);
    expect(facts.warnings.join(' ')).toContain('Margen de error alto');
    expect(facts.warnings.join(' ')).toContain('rango probable es muy amplio');
    expect(facts.warnings.join(' ')).toContain('no le ganó al promedio móvil');
  });
});
