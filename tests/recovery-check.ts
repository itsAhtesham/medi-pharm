import assert from 'node:assert/strict';
import { login, verifyToken, recoverOwner } from '../src/server/auth';
import { pool } from '../src/server/db';
async function main() {
  try {
    const old = process.env.REHEARSAL_OLD_PASSWORD!,
      fresh = process.env.REHEARSAL_NEW_PASSWORD!,
      token = process.env.REHEARSAL_OLD_TOKEN!;
    assert.equal(await verifyToken(token), null);
    await assert.rejects(() => login('restore@example.test', old, 'rehearsal'));
    await recoverOwner('restore@example.test', fresh);
    await assert.rejects(() => login('restore@example.test', old, 'rehearsal'));
    assert.equal(await verifyToken(token), null);
    assert.ok(await verifyToken((await login('restore@example.test', fresh, 'rehearsal')).token));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Restored credential check failed');
  process.exitCode = 1;
});
