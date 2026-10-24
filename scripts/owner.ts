import { prompt } from './prompt';
import { email, password } from '../src/lib/validation';
async function main() {
  if (!process.env.DATABASE_DIRECT_URL) throw new Error('Set DATABASE_DIRECT_URL');
  process.env.DATABASE_URL = process.env.DATABASE_DIRECT_URL;
  const { db, pool } = await import('../src/server/db');
  const { pharmacies, users } = await import('../src/server/db/schema');
  const { hashPassword, recoverOwner } = await import('../src/server/auth');
  try {
    const mode = process.argv[2];
    if (mode !== 'bootstrap' && mode !== 'recover')
      throw new Error('Usage: pnpm run owner bootstrap|recover');
    const address = email.parse(await prompt('Owner email: '));
    const pass = password.parse(await prompt('New passphrase (hidden, 15–128 characters): ', true));
    if (pass !== (await prompt('Confirm passphrase (hidden): ', true)))
      throw new Error('Passphrases do not match');
    if (mode === 'bootstrap') {
      const passwordHash = await hashPassword(pass);
      const name = await prompt('Pharmacy name: ');
      if (name.trim().length < 2) throw new Error('Pharmacy name is required');
      await db.transaction(async (tx) => {
        await tx.execute((await import('drizzle-orm')).sql`select pg_advisory_xact_lock(827193)`);
        if ((await tx.select().from(pharmacies).limit(1)).length)
          throw new Error('Already provisioned; use recovery');
        const [p] = await tx.insert(pharmacies).values({ name: name.trim() }).returning();
        await tx.insert(users).values({ pharmacyId: p.id, email: address, passwordHash });
      });
      console.log('Owner provisioned.');
    } else {
      console.log(
        'Proceed only after verifying the owner through the pre-established recovery channel.',
      );
      if ((await prompt('Type RESET to revoke all sessions and reset access: ')) !== 'RESET')
        throw new Error('Cancelled');
      await recoverOwner(address, pass);
      console.log('Password reset; all sessions revoked.');
    }
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Owner operation failed');
  process.exitCode = 1;
});
