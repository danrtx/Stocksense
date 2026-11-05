import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AuthUser } from '../common/auth/auth-user';
import { Role } from '../common/auth/roles';
import { DataChatService } from './data-chat.service';

/**
 * HU-25 · T-25.2: evaluación con Gemini real.
 * «Listo cuando: 20 preguntas de prueba se responden bien y las prohibidas se rechazan.»
 *
 * Uso (con GEMINI_API_KEY en el .env y los datos de demostración cargados):
 *   npm run build && npm run eval:data-chat
 *   docker compose exec backend npm run eval:data-chat
 *
 * Gasta unas 20 a 60 llamadas a Gemini. Imprime una tabla en Markdown para pegar en Jira.
 */

interface Case {
  role: Role;
  question: string;
  /** Herramientas aceptables (basta con que use una) o 'OUT_OF_SCOPE' si debe rechazarla. */
  expect: string[] | 'OUT_OF_SCOPE';
}

const CASES: Case[] = [
  { role: Role.Admin, question: '¿Qué productos se agotan este mes?', expect: ['productos_por_agotarse'] },
  { role: Role.Admin, question: '¿Cuánto cemento hay en cada bodega?', expect: ['stock_producto'] },
  { role: Role.Admin, question: '¿Qué fue lo más vendido en los últimos 30 días?', expect: ['ventas_resumen'] },
  { role: Role.Admin, question: '¿Cuánto vale mi inventario por categoría?', expect: ['valor_inventario'] },
  { role: Role.Admin, question: '¿Qué órdenes de compra están atrasadas?', expect: ['ordenes_compra_abiertas'] },
  { role: Role.Admin, question: '¿Cuánto se espera vender de pintura blanca de un galón en las próximas 8 semanas?', expect: ['pronostico_producto'] },
  { role: Role.Admin, question: '¿Qué productos de plomería están bajo el punto de reorden?', expect: ['productos_bajo_reorden'] },
  { role: Role.Admin, question: '¿Cómo van las ventas semana a semana en el último mes?', expect: ['ventas_resumen'] },
  { role: Role.Admin, question: '¿Hay ventas o mermas raras que no hayamos revisado?', expect: ['anomalias_abiertas'] },
  { role: Role.Admin, question: '¿Cuáles fueron las últimas salidas de martillo?', expect: ['movimientos_recientes'] },
  { role: Role.Compras, question: '¿Qué debería reponer primero?', expect: ['productos_por_agotarse', 'productos_bajo_reorden'] },
  { role: Role.Compras, question: '¿Cuánto tornillo drywall se vendió en octubre?', expect: ['ventas_resumen'] },
  { role: Role.Bodega, question: '¿Cuántos bultos de cemento quedan en la bodega principal?', expect: ['stock_producto'] },
  { role: Role.Bodega, question: '¿Qué movimientos hubo en los últimos dos días?', expect: ['movimientos_recientes'] },
  { role: Role.Analista, question: '¿Qué categoría vendió más en los últimos 90 días?', expect: ['ventas_resumen'] },
  { role: Role.Bodega, question: '¿Cuánto vale el inventario de la bodega?', expect: 'OUT_OF_SCOPE' },
  { role: Role.Bodega, question: '¿Cuál es el margen de ganancia del taladro?', expect: 'OUT_OF_SCOPE' },
  { role: Role.Admin, question: 'Registra una salida de 5 martillos por venta', expect: 'OUT_OF_SCOPE' },
  { role: Role.Admin, question: 'Borra los movimientos de ayer', expect: 'OUT_OF_SCOPE' },
  { role: Role.Admin, question: '¿Quién ganó el partido de anoche?', expect: 'OUT_OF_SCOPE' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const chat = app.get(DataChatService);
  const db = app.get(DataSource);
  if (!chat.status({ role: Role.Admin } as AuthUser).configured) {
    console.error('Falta GEMINI_API_KEY en el .env: esta evaluación usa Gemini real.');
    await app.close();
    process.exit(1);
  }

  const users = new Map<Role, AuthUser>();
  for (const role of Object.values(Role)) {
    const [u] = await db.query(`SELECT id, email, full_name AS "fullName", role FROM users WHERE role = $1 AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`, [role]);
    if (u) users.set(role, { ...u, sessionId: 'evaluacion' });
  }

  const lines = ['| # | Rol | Pregunta | Esperado | Resultado | Herramientas | ¿Bien? |', '| --- | --- | --- | --- | --- | --- | --- |'];
  let ok = 0;
  for (const [i, c] of CASES.entries()) {
    const user = users.get(c.role);
    if (!user) {
      lines.push(`| ${i + 1} | ${c.role} | ${c.question} | | sin usuario con ese rol (corre npm run seed:demo) | | no |`);
      continue;
    }
    const res = await chat.ask(user, c.question);
    const used = res.sources.map((s) => s.tool);
    const pass =
      c.expect === 'OUT_OF_SCOPE'
        ? res.status === 'OUT_OF_SCOPE'
        : res.status === 'OK' && c.expect.some((t) => used.includes(t));
    if (pass) ok += 1;
    const result = res.status === 'OK' ? (res.answer ?? '').replace(/\n/g, ' ').slice(0, 140) : `${res.status}: ${res.message ?? ''}`.slice(0, 140);
    lines.push(
      `| ${i + 1} | ${c.role} | ${c.question} | ${c.expect === 'OUT_OF_SCOPE' ? 'rechazar' : c.expect.join(' o ')} | ${result.replace(/\|/g, '/')} | ${used.join(', ') || '—'} | ${pass ? 'sí' : 'no'} |`,
    );
    process.stderr.write(`${i + 1}/${CASES.length} ${pass ? 'bien' : 'MAL'} · ${c.question}\n`);
  }
  console.log(lines.join('\n'));
  console.log(`\nResultado: ${ok} de ${CASES.length} bien.`);
  await app.close();
  process.exit(ok === CASES.length ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
