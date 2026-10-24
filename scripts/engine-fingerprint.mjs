import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export function engineFingerprint() {
  const hash = createHash('sha256');
  for (const file of [
    'engine/include/crtvd/engine.hpp',
    'engine/src/engine.cpp',
    'engine/src/wasm_api.cpp',
    'scripts/build-wasm.mjs',
    '.emscripten-version',
  ]) {
    hash.update(file);
    hash.update(readFileSync(new URL('../' + file, import.meta.url)));
  }
  return hash.digest('hex');
}
