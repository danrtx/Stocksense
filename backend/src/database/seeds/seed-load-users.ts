import bcrypt from 'bcryptjs';
import { AppDataSource } from '../data-source';

/**
 * Cuentas para la prueba de carga (HU-29): carga01@demo.co … carga50@demo.co, con el mismo
 * reparto de roles de una ferretería (más bodega y compras que analistas). Así cada persona
 * virtual de k6 tiene su propia sesión y su propio límite de peticiones, como en la vida real.
 *
 *   npm run seed:load-users        crea o reactiva las 50 cuentas
 *   npm run seed:load-users -- 20  solo 20
 *
 * Solo para desarrollo y pruebas.
 */
const PASSWORD = 'ClaveSegura2026';
const ROLES = ['BODEGA', 'BODEGA', 'COMPRAS', 'COMPRAS', 'ANALISTA', 'ADMIN'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('No se permite en producción.');
  const count = Math.min(200, Math.max(1, Number(process.argv[2] ?? 50)));
  await AppDataSource.initialize();
  const hash = await bcrypt.hash(PASSWORD, Number(process.env.BCRYPT_COST ?? 12));
  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(2, '0');
    await AppDataSource.query(
      `INSERT INTO users (email, full_name, role, status, password_hash)
       VALUES ($1, $2, $3, 'ACTIVE', $4)
       ON CONFLICT (email) DO UPDATE SET status = 'ACTIVE', password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
         failed_login_attempts = 0, locked_until = NULL, updated_at = now()`,
      [`carga${n}@demo.co`, `Prueba de carga ${n}`, ROLES[(i - 1) % ROLES.length], hash],
    );
  }
  console.log(`${count} cuentas de carga listas (carga01@demo.co … carga${String(count).padStart(2, '0')}@demo.co, clave ${PASSWORD}).`);
  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
