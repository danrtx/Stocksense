import { AppDataSource } from '../data-source';

/**
 * Genera productos de prueba para medir rendimiento (por defecto 10.000).
 * Uso: npm run seed:products -- 10000
 * Solo para desarrollo y pruebas: no lo corras en producción.
 */
async function seedProducts() {
  if (process.env.NODE_ENV === 'production') throw new Error('No se permite en producción.');
  const count = Number(process.argv[2] ?? 10_000);
  await AppDataSource.initialize();
  const start = Date.now();
  await AppDataSource.query(
    `INSERT INTO products (sku, name, description, category_id, unit, cost)
     SELECT 'DEMO-' || lpad(g::text, 6, '0'),
            (ARRAY['Tornillo','Martillo','Cable','Tubo PVC','Pintura','Cemento','Guante','Llave','Brocha','Taladro'])[1 + g % 10]
              || ' ' || (ARRAY['estándar','reforzado','galvanizado','industrial','premium'])[1 + g % 5]
              || ' #' || g,
            'Producto de demostración',
            -- Reparto desigual entre categorías para que los gráficos se parezcan a un negocio real
            (SELECT id FROM categories ORDER BY name
             OFFSET (CASE WHEN g % 100 < 28 THEN 1 WHEN g % 100 < 48 THEN 0 WHEN g % 100 < 63 THEN 4
                          WHEN g % 100 < 75 THEN 3 WHEN g % 100 < 85 THEN 2 WHEN g % 100 < 92 THEN 7
                          WHEN g % 100 < 97 THEN 6 ELSE 5 END) % (SELECT count(*) FROM categories)
             LIMIT 1),
            (ARRAY['UND','KG','L','M','CAJA'])[1 + g % 5]::unit_of_measure,
            round((random() * 200000 + 500)::numeric, 2)
     FROM generate_series(1, $1) AS g
     ON CONFLICT (sku) DO NOTHING`,
    [count],
  );
  await AppDataSource.query('ANALYZE products');
  console.log(`${count} productos de demostración listos en ${Date.now() - start} ms`);
  await AppDataSource.destroy();
}

seedProducts().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
