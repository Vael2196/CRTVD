import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = process.env.EMXX || (process.platform === 'win32' ? 'em++.bat' : 'em++');
const exports = [
  'malloc',
  'free',
  'crtvd_process',
  'crtvd_last_error',
  'crtvd_result_pixels',
  'crtvd_result_length',
  'crtvd_result_palette',
  'crtvd_result_palette_length',
  'crtvd_result_free',
];
const out = path.join(root, 'web/public/wasm');
mkdirSync(out, { recursive: true });
const args = [
  '-std=c++20',
  '-O3',
  '-fexceptions',
  '-Wall',
  '-Wextra',
  '-Wpedantic',
  '-Iengine/include',
  'engine/src/engine.cpp',
  'engine/src/wasm_api.cpp',
  '--no-entry',
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sEXPORT_NAME=createCrtvd',
  '-sENVIRONMENT=web,worker,node',
  '-sFILESYSTEM=0',
  '-sALLOW_MEMORY_GROWTH=1',
  '-sINITIAL_MEMORY=33554432',
  '-sMAXIMUM_MEMORY=268435456',
  '-sSTACK_SIZE=1048576',
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exports.map((x) => `_${x}`))}`,
  '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]',
  '-o',
  path.join(out, 'crtvd.js'),
];
const result = spawnSync(compiler, args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) {
  console.error(
    'Emscripten was not found. Install the SDK and source emsdk_env.sh in this terminal.',
  );
  console.error('See docs/GETTING_STARTED.md for the complete setup.');
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
const version = spawnSync(compiler, ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const build = {
  project: 'CRT Visual Downscaler',
  version: JSON.parse(readFileSync(path.join(root, 'package.json'))).version,
  compiler: version.stdout.split('\n')[0],
  simd: false,
};
writeFileSync(path.join(out, 'build.json'), JSON.stringify(build, null, 2) + '\n');
console.log('Built web/public/wasm/crtvd.js and crtvd.wasm');
