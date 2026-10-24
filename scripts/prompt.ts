import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
export async function prompt(label: string, hidden = false) {
  if (!process.stdin.isTTY) throw new Error('Owner commands require an interactive terminal');
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const question = rl.question(label);
  muted = hidden;
  try {
    return await question;
  } finally {
    muted = false;
    rl.close();
    if (hidden) process.stdout.write('\n');
  }
}
