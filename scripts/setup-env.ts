import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function main() {
  if (!(await exists('.env.local'))) {
    let content = await readFile('.env.example', 'utf8');
    content = content
      .replace(/^JWT_SECRET=$/m, 'JWT_SECRET=' + randomBytes(32).toString('hex'))
      .replace(/^RATE_LIMIT_SECRET=$/m, 'RATE_LIMIT_SECRET=' + randomBytes(32).toString('hex'));
    await writeFile('.env.local', content, { mode: 0o600, flag: 'wx' });
    console.log('Created local environment with separate random secrets.');
  } else console.log('Existing .env.local preserved.');
  if (!(await exists('.env.test.local')))
    await writeFile('.env.test.local', await readFile('.env.test.example', 'utf8'), {
      mode: 0o600,
      flag: 'wx',
    });
}
main().catch(() => {
  console.error('Could not create local environment');
  process.exitCode = 1;
});
