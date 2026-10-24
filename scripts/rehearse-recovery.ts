import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { hash, verify } from '@node-rs/argon2';
import { SignJWT } from 'jose';
const exec = promisify(execFile);
async function main() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection) throw new Error('TEST_DATABASE_URL required');
  const origin = new URL(connection);
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || !origin.pathname.endsWith('_test'))
    throw new Error('Recovery rehearsal requires a local disposable test database');
  const admin = new Pool({ connectionString: connection, max: 1 });
  const suffix = randomBytes(4).toString('hex');
  const sourceName = `medi_backup_${suffix}_test`,
    targetName = `medi_restore_${suffix}_test`;
  const sourceUrl = new URL(connection);
  sourceUrl.pathname = '/' + sourceName;
  const targetUrl = new URL(connection);
  targetUrl.pathname = '/' + targetName;
  const directory = await mkdtemp(path.join(tmpdir(), 'medi-pharm-recovery-'));
  const gpgHome = path.join(directory, 'gnupg');
  await mkdir(gpgHome, { mode: 0o700 });
  const env = {
    ...process.env,
    GNUPGHOME: gpgHome,
    DATABASE_DIRECT_URL: sourceUrl.toString(),
    BACKUP_DIRECTORY: path.join(directory, 'archives'),
  };
  let source: Pool | undefined, target: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${sourceName}`);
    await admin.query(`CREATE DATABASE ${targetName}`);
    source = new Pool({ connectionString: sourceUrl.toString() });
    target = new Pool({ connectionString: targetUrl.toString() });
    await migrate(drizzle(source), { migrationsFolder: 'drizzle' });
    const oldPassword = randomBytes(24).toString('base64url');
    const newPassword = randomBytes(24).toString('base64url');
    const jwtSecret = randomBytes(32).toString('hex');
    const {
      rows: [p],
    } = await source.query(
      "insert into pharmacies(name) values ('Recovery rehearsal') returning id",
    );
    const {
      rows: [u],
    } = await source.query(
      'insert into users(pharmacy_id,email,password_hash) values ($1,$2,$3) returning id',
      [p.id, 'restore@example.test', await hash(oldPassword)],
    );
    const {
      rows: [session],
    } = await source.query(
      "insert into sessions(user_id,expires_at) values ($1,now()+interval '8 hours') returning id",
      [u.id],
    );
    const oldToken = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id)
      .setIssuer('medi-pharm')
      .setAudience('pharmacy-owner')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(new TextEncoder().encode(jwtSecret));
    await source.query(
      "insert into customers(pharmacy_id,name,phone,phone_normalized) values ($1,'Synthetic recovery record','+12025550199','+12025550199')",
      [p.id],
    );
    await exec(
      'gpg',
      [
        '--batch',
        '--pinentry-mode',
        'loopback',
        '--passphrase',
        '',
        '--quick-generate-key',
        'Medi Pharm Rehearsal <test@example.test>',
        'default',
        'default',
        '1d',
      ],
      { env },
    );
    const keys = await exec('gpg', ['--batch', '--with-colons', '--list-keys'], { env });
    const fingerprint = keys.stdout
      .split('\n')
      .find((line) => line.startsWith('fpr:'))!
      .split(':')[9];
    const backupEnv = { ...env, BACKUP_GPG_RECIPIENT: fingerprint, PGCONNECT_TIMEOUT: '2' };
    await exec('pnpm', ['exec', 'tsx', 'scripts/backup.ts'], { env: backupEnv });
    const metaPath = path.join(env.BACKUP_DIRECTORY, 'last-success.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    await exec('pnpm', ['exec', 'tsx', 'scripts/backup.ts', '--check-stale'], { env: backupEnv });
    await writeFile(metaPath, JSON.stringify({ ...meta, completedAt: '2000-01-01T00:00:00Z' }));
    let rejected = false;
    try {
      await exec('pnpm', ['exec', 'tsx', 'scripts/backup.ts', '--check-stale'], { env: backupEnv });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('Stale backup was not detected');
    await writeFile(metaPath, JSON.stringify(meta));
    let failed = false;
    try {
      const bad = new URL(sourceUrl);
      bad.port = '1';
      await exec('pnpm', ['exec', 'tsx', 'scripts/backup.ts'], {
        env: { ...backupEnv, DATABASE_DIRECT_URL: bad.toString() },
      });
    } catch {
      failed = true;
    }
    if (!failed) throw new Error('Backup failure did not exit nonzero');
    await source.query('update users set password_hash=$1', [await hash(newPassword)]);
    await exec(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/restore.ts',
        path.join(env.BACKUP_DIRECTORY, meta.file),
        '--confirm-isolated-restore',
      ],
      { env: { ...backupEnv, RESTORE_DATABASE_URL: targetUrl.toString() } },
    );
    const {
      rows: [restored],
    } = await target.query('select password_hash,is_active from users');
    if (restored.is_active || !(await verify(restored.password_hash, oldPassword)))
      throw new Error('Restore did not disable the backup-era credential');
    const {
      rows: [restoredSession],
    } = await target.query('select revoked_at from sessions');
    if (!restoredSession.revoked_at) throw new Error('Restored session remained active');
    const {
      rows: [n],
    } = await target.query('select count(*)::int as n from customers');
    if (n.n !== 1) throw new Error('Customer record did not restore');
    await exec('pnpm', ['exec', 'tsx', 'tests/recovery-check.ts'], {
      env: {
        ...process.env,
        DATABASE_URL: targetUrl.toString(),
        JWT_SECRET: jwtSecret,
        RATE_LIMIT_SECRET: randomBytes(32).toString('hex'),
        REHEARSAL_OLD_PASSWORD: oldPassword,
        REHEARSAL_NEW_PASSWORD: newPassword,
        REHEARSAL_OLD_TOKEN: oldToken,
      },
    });
    console.log(
      'Recovery rehearsal passed: encrypted backup, checksum, stale/failure detection, isolated restore, old password/session rejection, and recovered login.',
    );
  } finally {
    await source?.end();
    await target?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`);
    await admin.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`);
    await admin.end();
    await exec('gpgconf', ['--kill', 'gpg-agent'], { env }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Recovery rehearsal failed');
  process.exitCode = 1;
});
