import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const built = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./build-sdk.mjs', import.meta.url))],
  { stdio: 'inherit' },
);
if (built.status !== 0) process.exit(built.status ?? 1);
mkdirSync('release', { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packed = spawnSync(
  npm,
  ['pack', '--workspace', '@vael2196/crtvd', '--pack-destination', 'release'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(packed.status ?? 1);
