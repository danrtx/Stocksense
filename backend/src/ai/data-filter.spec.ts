import { FORECAST_FIELDS, pickAllowed, scrubText } from './data-filter';

describe('T-23.2 · Filtro de datos para Gemini', () => {
  it('solo deja pasar los campos permitidos, también dentro de listas', () => {
    const out = pickAllowed(
      {
        product: { sku: 'MAR-001', name: 'Martillo', cost: 23456, supplierEmail: 'x@y.co' },
        forecast: [{ week: '2026-10-12', yhat: 3, createdBy: 'ana@x.co' }],
        userEmail: 'ana@x.co',
      },
      FORECAST_FIELDS,
    );
    expect(out).toEqual({ product: { sku: 'MAR-001', name: 'Martillo' }, forecast: [{ week: '2026-10-12', yhat: 3 }] });
  });

  it('quita correos, claves, contraseñas, montos y teléfonos del texto libre', () => {
    const text = scrubText(
      'Soy ana@empresa.co, mi contraseña es Secreta#2026, la clave ssk_abcdEFGH1234 y AIzaSyD-1234567890abcdefghijklmn. ' +
        'El costo es 45.000 y el precio $12.500. Llámame al 300 123 4567. ¿Cómo registro 3 cajas de MAR-001?',
    );
    expect(text).not.toMatch(/ana@empresa|Secreta|ssk_|AIza|45\.000|12\.500|300 123/);
    expect(text).toContain('[correo]');
    expect(text).toContain('contraseña [oculto]');
    expect(text).toContain('costo [monto]');
    expect(text).toContain('¿Cómo registro 3 cajas de MAR-001?');
  });
});
