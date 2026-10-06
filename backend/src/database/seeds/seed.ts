import bcrypt from 'bcryptjs';
import { AppDataSource } from '../data-source';
import { Role } from '../../common/auth/roles';
import { Category } from '../../products/category.entity';
import { User, UserStatus } from '../../users/user.entity';

export const DEFAULT_CATEGORIES = [
  'Herramientas',
  'Ferretería',
  'Eléctricos',
  'Plomería',
  'Pinturas',
  'Construcción',
  'Jardinería',
  'Seguridad industrial',
];

/**
 * Crea el primer administrador (ADMIN_EMAIL / ADMIN_PASSWORD) y las categorías base.
 * Es idempotente: se puede correr varias veces sin duplicar datos.
 */
async function seed() {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();

  const categories = AppDataSource.getRepository(Category);
  for (const name of DEFAULT_CATEGORIES) {
    await categories.createQueryBuilder().insert().values({ name }).orIgnore().execute();
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const users = AppDataSource.getRepository(User);
    if (!(await users.exist({ where: { email } }))) {
      const cost = Number(process.env.BCRYPT_COST ?? 12);
      await users.insert({
        email,
        fullName: 'Administrador',
        role: Role.Admin,
        status: UserStatus.Active,
        passwordHash: await bcrypt.hash(password, cost),
      });
      console.log(`Administrador creado: ${email}`);
    } else {
      console.log(`El administrador ${email} ya existe.`);
    }
  } else {
    console.log('ADMIN_EMAIL o ADMIN_PASSWORD vacíos: no se creó administrador.');
  }
  await AppDataSource.destroy();
}

seed().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
