// Prueba de carga de HU-29 (T-29.1): 50 personas usando las pantallas principales a la vez.
//
//   k6 run load/pantallas.js
//   k6 run -e BASE_URL=http://localhost:8080/api -e VUS=50 load/pantallas.js
//
// Antes: npm run seed:load-users (dentro de backend/) crea carga01@demo.co … carga50@demo.co.
// Cada persona virtual inicia sesión con su propia cuenta, como 50 personas distintas.
//
// Cada persona virtual abre una pantalla, la "lee" de 2 a 5 segundos y abre otra, igual que
// alguien trabajando. Cada pantalla pide a la API lo mismo que pide el navegador al abrirla
// completa (incluida la sesión y el contador de alertas).
// Criterio de aceptación: el 95 % de las pantallas responde en menos de 2 segundos.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000/api';
const VUS = Number(__ENV.VUS || 50);
const DEMO_PASSWORD = __ENV.DEMO_PASSWORD || 'ClaveSegura2026';

// Tiempo de la pantalla completa: todas sus peticiones en paralelo, como el navegador.
const screenTime = new Trend('pantalla_completa', true);

const SCREENS = {
  Panel: ['/auth/me', '/alerts/summary', '/warehouses', '/categories', '/dashboard/kpis', '/dashboard/summary', '/forecast/summary?limit=5', '/forecast/recent-accuracy', '/alerts?status=active&limit=4'],
  Productos: ['/auth/me', '/alerts/summary', '/categories', '/products?active=true&page=1&limit=20'],
  Inventario: ['/auth/me', '/alerts/summary', '/categories', '/stock?status=all&page=1&limit=20'],
  Movimientos: ['/auth/me', '/alerts/summary', '/warehouses', '/movements?page=1&limit=25'],
  Compras: ['/auth/me', '/alerts/summary', '/purchase-orders?page=1&limit=20'],
  Alertas: ['/auth/me', '/alerts/summary', '/alerts?status=active&page=1&limit=20'],
  Pronostico: ['/auth/me', '/alerts/summary', '/forecast/summary?sort=demand&page=1&limit=15'],
  Reportes: ['/auth/me', '/alerts/summary', '/warehouses', '/categories', '/anomalies/counts', '/reports/stock'],
  Ventas: ['/auth/me', '/alerts/summary', '/sales/overview', '/sales/imports?limit=10'],
};

// Qué pantallas abre cada rol (las que su menú le muestra).
const ROLE_SCREENS = {
  admin: Object.keys(SCREENS),
  compras: ['Panel', 'Productos', 'Inventario', 'Compras', 'Alertas', 'Pronostico'],
  bodega: ['Panel', 'Productos', 'Inventario', 'Movimientos', 'Alertas'],
  analista: ['Panel', 'Productos', 'Inventario', 'Pronostico', 'Reportes', 'Ventas'],
};

export const options = {
  setupTimeout: '5m',
  scenarios: {
    pantallas: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: VUS },
        { duration: '2m', target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    pantalla_completa: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

// Lo que el navegador no pide porque el rol no tiene permiso (el panel de Bodega no muestra
// el pronóstico y el de Analista no muestra alertas).
const HIDDEN = {
  admin: [],
  compras: [],
  bodega: ['/forecast/'],
  analista: ['/alerts'],
};
const requestsFor = (role, name) => SCREENS[name].filter((path) => !HIDDEN[role].some((prefix) => path.startsWith(prefix)));

// Mismo reparto que seed-load-users: más bodega y compras que analistas.
const ROLES = ['bodega', 'bodega', 'compras', 'compras', 'analista', 'admin'];

function login(email, password) {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password }), { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'inicio de sesión': (r) => r.status === 200 });
  return res.json('accessToken');
}

// El inicio de sesión tiene su propio límite por IP (20 por minuto, contra fuerza bruta):
// las 50 sesiones se abren antes de medir, con una pausa entre una y otra.
export function setup() {
  const accounts = [];
  for (let i = 1; i <= VUS; i++) {
    const n = String(i).padStart(2, '0');
    accounts.push({ role: ROLES[(i - 1) % ROLES.length], token: login(`carga${n}@demo.co`, DEMO_PASSWORD) });
    if (i < VUS) sleep(3.1);
  }
  return { accounts };
}

export default function ({ accounts }) {
  const { role, token } = accounts[(__VU - 1) % accounts.length];
  const screens = ROLE_SCREENS[role];
  const name = screens[Math.floor(Math.random() * screens.length)];
  const params = { headers: { Authorization: `Bearer ${token}` }, tags: { pantalla: name } };

  group(name, () => {
    const started = Date.now();
    const responses = http.batch(requestsFor(role, name).map((path) => ['GET', `${BASE}${path}`, null, params]));
    screenTime.add(Date.now() - started, { pantalla: name });
    check(responses, { 'todas las peticiones responden 200': (rs) => rs.every((r) => r.status === 200) });
  });
  sleep(2 + Math.random() * 3);
}

export function handleSummary(data) {
  const p = (metric, q) => (data.metrics[metric]?.values?.[q] ?? 0).toFixed(0);
  const lines = [
    `Pantalla completa: p50 ${p('pantalla_completa', 'med')} ms · p95 ${p('pantalla_completa', 'p(95)')} ms · máx ${p('pantalla_completa', 'max')} ms`,
    `Peticiones: ${data.metrics.http_reqs.values.count} · fallidas ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)} %`,
  ];
  return { stdout: `\n${lines.join('\n')}\n`, 'load/resultado.json': JSON.stringify(data, null, 2) };
}
