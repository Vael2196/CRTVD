import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(path.join(root, 'build/native'), { recursive: true });
const compiler = process.env.CXX || 'g++';
const binary = path.join(
  root,
  'build/native',
  process.platform === 'win32' ? 'crtvd_tests.exe' : 'crtvd_tests',
);
const flags = ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Wpedantic'];
if (process.env.CRTVD_SANITIZE === '1')
  flags.push('-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-g');
const compile = spawnSync(
  compiler,
  [
    ...flags,
    '-Iengine/include',
    'engine/src/engine.cpp',
    'engine/src/wasm_api.cpp',
    'engine/tests/test_engine.cpp',
    '-o',
    binary,
  ],
  { cwd: root, stdio: 'inherit' },
);
if (compile.error) {
  console.error('Install a C++20 compiler (g++ or clang++) or set CXX.');
  process.exit(1);
}
if (compile.status !== 0) process.exit(compile.status ?? 1);
const run = spawnSync(binary, [], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
