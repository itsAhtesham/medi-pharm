import { lt } from 'drizzle-orm';
import { db, pool } from '../src/server/db';
import { sessions, authRateLimits } from '../src/server/db/schema';
async function main() {
  try {
    if (process.argv[2] !== 'cleanup') throw new Error('Usage: pnpm ops cleanup');
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date(Date.now() - 30 * 86400000)));
    await db
      .delete(authRateLimits)
      .where(lt(authRateLimits.windowStart, new Date(Date.now() - 86400000)));
    console.log('Expired session and limiter rows removed. Mutation receipts retained.');
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Cleanup failed');
  process.exitCode = 1;
});
