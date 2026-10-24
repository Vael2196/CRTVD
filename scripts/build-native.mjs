import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = 'build/native-release';
mkdirSync(out, { recursive: true });
const compiler = process.env.CXX || 'g++';
const flags = [
  '-std=c++20',
  '-O3',
  '-DNDEBUG',
  '-Wall',
  '-Wextra',
  '-Wpedantic',
  '-Iengine/include',
  '-Inative',
  '-isystem',
  'engine/vendor',
];
for (const [source, target] of [
  ['native/cli.cpp', 'crtvd'],
  ['benchmarks/native.cpp', 'crtvd-bench'],
]) {
  const result = spawnSync(
    compiler,
    [
      ...flags,
      'engine/src/engine.cpp',
      'native/image_io.cpp',
      source,
      '-o',
      `${out}/${target}${process.platform === 'win32' ? '.exe' : ''}`,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) {
    console.error('Install a C++20 compiler or set CXX.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
