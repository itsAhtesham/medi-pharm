import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
if (existsSync('.env.test.local')) process.loadEnvFile('.env.test.local');
export default defineConfig({
  resolve: { alias: { '@': path.resolve('src') } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
