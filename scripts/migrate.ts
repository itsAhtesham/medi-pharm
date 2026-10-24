import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
if (!process.env.DATABASE_DIRECT_URL) throw new Error('DATABASE_DIRECT_URL required');
const pool = new Pool({ connectionString: process.env.DATABASE_DIRECT_URL, max: 1 });
async function main() {
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Migration failed. Check database access and migration compatibility.');
  process.exitCode = 1;
});
