import { mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engineFingerprint } from './engine-fingerprint.mjs';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of ['crtvd.js', 'crtvd.wasm', 'build.json']) {
  if (!existsSync(new URL(`../web/public/wasm/${file}`, import.meta.url))) {
    console.error('Wasm build missing. Activate Emscripten, then run npm run build:wasm.');
    process.exit(1);
  }
}
const metadata = JSON.parse(
  readFileSync(new URL('../web/public/wasm/build.json', import.meta.url)),
);
if (metadata.sourceSha256 !== engineFingerprint()) {
  console.error(
    'The Wasm build is stale. Activate Emscripten, run npm run build:wasm, then retry.',
  );
  process.exit(1);
}
for (const [name, key] of [
  ['crtvd.js', 'loaderSha256'],
  ['crtvd.wasm', 'wasmSha256'],
]) {
  const digest = createHash('sha256')
    .update(readFileSync(new URL('../web/public/wasm/' + name, import.meta.url)))
    .digest('hex');
  if (metadata[key] !== digest) {
    console.error('Wasm loader/binary integrity mismatch. Rebuild with npm run build:wasm.');
    process.exit(1);
  }
}
const result = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.json'],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(new URL('../packages/core/lib/wasm/', import.meta.url), { recursive: true });
for (const file of ['crtvd.js', 'crtvd.wasm', 'build.json'])
  copyFileSync(
    new URL(`../web/public/wasm/${file}`, import.meta.url),
    new URL(`../packages/core/lib/wasm/${file}`, import.meta.url),
  );
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  copyFileSync(
    new URL(`../${file}`, import.meta.url),
    new URL(`../packages/core/${file}`, import.meta.url),
  );
console.log('Built @vael2196/crtvd JavaScript, declarations and Wasm assets.');
