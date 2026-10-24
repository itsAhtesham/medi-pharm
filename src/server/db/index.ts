import { Pool, types } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { attachDatabasePool } from '@vercel/functions';
import * as schema from './schema';
types.setTypeParser(1082, (value) => value);
const globalDb = globalThis as unknown as { mediPool?: Pool };
export const pool =
  globalDb.mediPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  });
if (process.env.VERCEL) attachDatabasePool(pool);
if (process.env.NODE_ENV !== 'production') globalDb.mediPool = pool;
export const db = drizzle(pool, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
