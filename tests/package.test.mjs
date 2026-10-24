import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('packed SDK installs and runs outside the repository without runtime dependencies', () => {
  const tarball = path.resolve('release/vael2196-crtvd-0.3.0.tgz');
  const dir = mkdtempSync(path.join(tmpdir(), 'crtvd-consumer-'));
  try {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    const installed = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', tarball],
      { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' },
    );
    assert.equal(installed.status, 0, installed.stderr);
    const source = `import {createProcessor} from '@vael2196/crtvd';
import {readFile} from 'node:fs/promises';
const wasmBinary=await readFile(new URL(import.meta.resolve('@vael2196/crtvd/wasm/crtvd.wasm')));
const processor=await createProcessor({wasmBinary});
const result=processor.processFrame({data:new Uint8Array([12,34,56,255]),width:1,height:1},{dither:'none'});
if(result.data.join(',')!=='12,34,56,255')throw new Error('Wrong consumer output');
processor.dispose();console.log('consumer passed');`;
    writeFileSync(path.join(dir, 'consumer.mjs'), source);
    const run = spawnSync(process.execPath, ['consumer.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /consumer passed/);
    writeFileSync(
      path.join(dir, 'consumer.ts'),
      `import {createProcessor, type ProcessOptions} from '@vael2196/crtvd';\nconst options:ProcessOptions={width:1,dither:'none'};\nconst p=await createProcessor();\np.processFrame({data:new Uint8Array(4),width:1,height:1},options);p.dispose();\n`,
    );
    const check = spawnSync(
      process.execPath,
      [
        path.resolve('node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--lib',
        'ES2022,DOM',
        'consumer.ts',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.ok(
      readdirSync(path.join(dir, 'node_modules/@vael2196/crtvd/lib/wasm')).includes('crtvd.wasm'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
