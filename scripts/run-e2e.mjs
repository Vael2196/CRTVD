import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Vite preview serves dist; it does not build it. Always rebuild the UI before
// launching local tests, and never reuse another process's preview server.
const env = { ...process.env };
if (!env.TEST_BASE_URL) {
  env.BASE_PATH = '/';
  const built = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./build-web.mjs', import.meta.url))],
    { stdio: 'inherit', env },
  );
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const result = spawnSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
  { stdio: 'inherit', env },
);
process.exit(result.status ?? 1);
