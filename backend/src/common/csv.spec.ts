import { analyzeCoverage } from '../sales/sales-import.service';
import { csvCell, normalizeHeader, parseDate, parseDecimal, readCsv } from './csv';

describe('Lectura de CSV', () => {
  it('entiende números con coma o punto decimal y separador de miles', () => {
    expect(parseDecimal('25900')).toBe(25900);
    expect(parseDecimal('25900.5')).toBe(25900.5);
    expect(parseDecimal('25900,5')).toBe(25900.5);
    expect(parseDecimal('25.900,50')).toBe(25900.5);
    expect(parseDecimal('25,900.50')).toBe(25900.5);
    expect(parseDecimal('$ 1.234.567')).toBe(1234567);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('-3')).toBe(-3);
  });

  it('acepta fechas AAAA-MM-DD y DD/MM/AAAA y rechaza fechas imposibles', () => {
    expect(parseDate('2026-03-15')).toBe('2026-03-15');
    expect(parseDate('15/03/2026')).toBe('2026-03-15');
    expect(parseDate('5-3-2026')).toBe('2026-03-05');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('marzo')).toBeNull();
  });

  it('normaliza encabezados con tildes, mayúsculas y BOM', () => {
    expect(normalizeHeader('﻿ Categoría ')).toBe('categoria');
    expect(normalizeHeader('Punto de Reorden')).toBe('punto_de_reorden');
  });

  it('detecta el separador y usa alias de columnas', () => {
    const file = readCsv(Buffer.from('Código;Producto\nA-1;Uno\n'), {
      columns: { sku: ['codigo'], nombre: ['producto'] },
      required: ['sku', 'nombre'],
      maxRows: 10,
    });
    expect(file.delimiter).toBe(';');
    expect(file.rows).toEqual([{ line: 2, values: { sku: 'A-1', nombre: 'Uno' } }]);
  });

  it('escapa celdas para el archivo de errores', () => {
    expect(csvCell('hola, "mundo"')).toBe('"hola, ""mundo"""');
    expect(csvCell(null)).toBe('');
  });

  it('el informe de cobertura cuenta días sin ventas y productos con poca historia', () => {
    const report = analyzeCoverage([
      { productId: 'a', date: '2026-01-01' },
      { productId: 'a', date: '2026-01-20' },
      { productId: 'b', date: '2026-01-02' },
    ]);
    expect(report).toMatchObject({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-20',
      daysCovered: 3,
      daysWithoutSales: 17,
      gaps: [{ from: '2026-01-03', to: '2026-01-19', days: 17 }],
      products: 2,
      productsWithShortHistory: 2,
    });
  });
});
