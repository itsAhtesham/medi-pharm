import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { pgEnvironment } from './pg-env';
function completed(child: ReturnType<typeof spawn>, label: string) {
  return new Promise<void>((resolve, reject) => {
    child.on('error', () => reject(new Error(`${label} could not start`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed`))));
  });
}
async function main() {
  const file = process.argv[2],
    url = process.env.RESTORE_DATABASE_URL;
  if (!file || !url || !process.argv.includes('--confirm-isolated-restore'))
    throw new Error(
      'Usage: RESTORE_DATABASE_URL=<empty isolated direct DB> pnpm restore <archive.dump.gpg> --confirm-isolated-restore',
    );
  const meta = JSON.parse(await readFile(file + '.json', 'utf8'));
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest('hex') !== meta.sha256) throw new Error('Backup checksum mismatch');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query(
      "select count(*)::int as n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')",
    );
    if (rows[0].n !== 0) throw new Error('Restore target must be an empty isolated database');
    const decrypt = spawn('gpg', ['--batch', '--decrypt', file], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const restore = spawn(
      'pg_restore',
      ['--dbname', pgEnvironment(url).PGDATABASE, '--no-owner', '--no-acl', '--exit-on-error'],
      { env: pgEnvironment(url), stdio: ['pipe', 'ignore', 'ignore'] },
    );
    try {
      await Promise.all([
        completed(decrypt, 'Decryption'),
        completed(restore, 'Database restore'),
        pipeline(decrypt.stdout!, restore.stdin!),
      ]);
    } catch (error) {
      decrypt.kill();
      restore.kill();
      throw error;
    }
    await pool.query('BEGIN');
    await pool.query('UPDATE users SET is_active=false');
    await pool.query('UPDATE sessions SET revoked_at=now()');
    await pool.query('COMMIT');
    console.log(
      'Backup restored to isolated database. All owner accounts are disabled and restored sessions revoked.',
    );
    console.log(
      'Before opening traffic: point DATABASE_DIRECT_URL to this database and run pnpm run owner recover. Verify old credentials fail, then perform smoke checks.',
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Restore failed');
  process.exitCode = 1;
});
