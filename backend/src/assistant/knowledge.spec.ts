import { Role } from '../common/auth/roles';
import { routesInText, stripUnknownRoutes } from './assistant.service';
import { articleAllowed, expandExamples, KNOWLEDGE, MIN_EXAMPLES, rolesThatCan } from './knowledge.service';

describe('HU-32 · Base de conocimiento', () => {
  const { articles } = KNOWLEDGE;

  it('cada ficha tiene nombre, pasos, resumen y al menos 20 preguntas de ejemplo', () => {
    const missing = articles
      .map((a) => ({ id: a.id, examples: expandExamples(a).length, steps: a.steps.length, summary: a.summary.length }))
      .filter((a) => a.examples < MIN_EXAMPLES || a.steps === 0 || a.summary < 20);
    expect(missing).toEqual([]);
  });

  it('los id son únicos y las rutas son rutas de la aplicación', () => {
    expect(new Set(articles.map((a) => a.id)).size).toBe(articles.length);
    for (const a of articles) if (a.route) expect(a.route).toMatch(/^\/[a-z0-9/\-?=&]*$/);
  });

  it('los permisos de las fichas existen y se respetan por rol', () => {
    const order = articles.find((a) => a.id === 'crear-orden')!;
    expect(articleAllowed(order, Role.Compras)).toBe(true);
    expect(articleAllowed(order, Role.Bodega)).toBe(false);
    expect(rolesThatCan(order)).toEqual([Role.Admin, Role.Compras]);
    const orders = articles.find((a) => a.id === 'ver-ordenes')!;
    expect(articleAllowed(orders, Role.Bodega)).toBe(true); // basta con purchases:receive
    expect(articleAllowed(orders, Role.Analista)).toBe(true);
  });

  it('T-35.2: las rutas que no están en el catálogo se quitan del texto', () => {
    expect(routesInText('Ve a /inventario y luego a /compras/ordenes/nueva.')).toEqual(['/inventario', '/compras/ordenes/nueva']);
    const out = stripUnknownRoutes('Ve a /inventario o a /admin/oculto.', new Set(['/inventario']));
    expect(out.text).toBe('Ve a /inventario o a (pantalla no disponible).');
    expect(out.removed).toEqual(['/admin/oculto']);
    expect(stripUnknownRoutes('1/2 pulgada y 3/4', new Set()).removed).toEqual([]);
  });
});
