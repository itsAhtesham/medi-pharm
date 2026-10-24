import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { hash } from '@node-rs/argon2';
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('E2E requires a disposable _test database');
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    await pool.query('TRUNCATE pharmacies, auth_rate_limits CASCADE');
    const {
      rows: [p],
    } = await pool.query("INSERT INTO pharmacies(name) VALUES ('Lavender Pharmacy') RETURNING id");
    await pool.query('INSERT INTO users(pharmacy_id,email,password_hash) VALUES ($1,$2,$3)', [
      p.id,
      'owner@example.test',
      await hash(process.env.E2E_PASSWORD!, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    ]);
  } finally {
    await pool.end();
  }
}
