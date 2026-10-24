import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pgEnvironment } from './pg-env';
function completed(child: ReturnType<typeof spawn>, label: string) {
  return new Promise<void>((resolve, reject) => {
    child.on('error', () => reject(new Error(`${label} could not start`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed`))));
  });
}
async function main() {
  process.umask(0o077);
  const dir = process.env.BACKUP_DIRECTORY;
  if (!dir || !path.isAbsolute(dir))
    throw new Error('Set BACKUP_DIRECTORY to an absolute path on restricted off-database storage');
  if (process.argv.includes('--check-stale')) {
    const meta = JSON.parse(await readFile(path.join(dir, 'last-success.json'), 'utf8'));
    if (Date.now() - Date.parse(meta.completedAt) > 26 * 3600000)
      throw new Error('No successful backup in the last 26 hours');
    console.log('Backup freshness check passed.');
    return;
  }
  const url = process.env.DATABASE_DIRECT_URL,
    recipient = process.env.BACKUP_GPG_RECIPIENT;
  if (!url || !recipient || !/^[A-Fa-f0-9]{40,64}$/.test(recipient))
    throw new Error('Direct database URL and full GPG recipient fingerprint required');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `medi-pharm-${new Date().toISOString().replace(/[:.]/g, '-')}.dump.gpg`;
  const target = path.join(dir, name),
    partial = target + '.partial';
  const dump = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
    env: pgEnvironment(url),
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const encrypt = spawn(
    'gpg',
    [
      '--batch',
      '--yes',
      '--trust-model',
      'always',
      '--recipient',
      recipient,
      '--encrypt',
      '--output',
      partial,
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  try {
    await Promise.all([
      completed(dump, 'Database dump'),
      completed(encrypt, 'Encryption'),
      pipeline(dump.stdout!, encrypt.stdin!),
    ]);
  } catch (error) {
    dump.kill();
    encrypt.kill();
    await unlink(partial).catch(() => {});
    throw error;
  }
  await rename(partial, target);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(target)) digest.update(chunk);
  const meta = {
    file: name,
    sha256: digest.digest('hex'),
    bytes: (await stat(target)).size,
    completedAt: new Date().toISOString(),
  };
  await writeFile(target + '.json', JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(dir, 'last-success.json.tmp'), JSON.stringify(meta, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(path.join(dir, 'last-success.json.tmp'), path.join(dir, 'last-success.json'));
  for (const file of await readdir(dir)) {
    if (!/^medi-pharm-\d{4}-.*\.dump\.gpg(?:\.json)?$/.test(file)) continue;
    const full = path.join(dir, file);
    if (Date.now() - (await stat(full)).mtimeMs > 30 * 86400000) await unlink(full);
  }
  console.log('Encrypted backup and checksum recorded.');
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backup failed');
  console.error('Backup runner must notify the assigned operator on this non-zero exit.');
  process.exitCode = 1;
});
