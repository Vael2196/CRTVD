import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
const binary = `build/native-release/crtvd${process.platform === 'win32' ? '.exe' : ''}`;
const run = (args) => spawnSync(binary, args, { encoding: 'utf8' });
test('CLI reports help/version and rejects invalid options', () => {
  assert.match(run(['--help']).stdout, /PNG\/JPEG/);
  assert.equal(run(['--version']).stdout.trim(), '0.3.0');
  assert.notEqual(run(['a', 'b.png', '--unknown']).status, 0);
});
test('CLI exports PNG, palette and report; protects source and existing files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crtvd-cli-'));
  try {
    const output = path.join(dir, 'out.png'),
      palette = path.join(dir, 'palette.hex'),
      report = path.join(dir, 'report.json');
    const args = [
      'tests/reference/input-scene.png',
      output,
      '--width',
      '32',
      '--colours',
      '8',
      '--palette-out',
      palette,
      '--report',
      report,
    ];
    const done = run(args);
    assert.equal(done.status, 0, done.stderr);
    const png = PNG.sync.read(readFileSync(output));
    assert.equal(png.width, 32);
    assert.equal(png.height, 21);
    assert.ok(JSON.parse(readFileSync(report)).palette.length <= 24);
    assert.match(readFileSync(palette, 'utf8'), /^#[0-9a-f]{6}/);
    const before = readFileSync(output);
    assert.notEqual(run(args).status, 0);
    assert.deepEqual(readFileSync(output), before);
    assert.equal(run([...args, '--force']).status, 0);
    assert.notEqual(run([output, output, '--force']).status, 0);
    if (process.platform !== 'win32') {
      const source = path.join(dir, 'source.png'),
        alias = path.join(dir, 'source-alias.png');
      copyFileSync('tests/reference/input-scene.png', source);
      symlinkSync(source, alias);
      const original = readFileSync(source);
      assert.notEqual(
        run([source, path.join(dir, 'other.png'), '--report', alias, '--force']).status,
        0,
      );
      assert.deepEqual(readFileSync(source), original);
    }
    assert.notEqual(
      run(['tests/reference/input-scene.png', path.join(dir, 'bad.png'), '--width', 'NaN']).status,
      0,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CLI accepts JPEG and a custom RGB palette, rejecting unsupported inputs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crtvd-cli-'));
  try {
    const palette = path.join(dir, 'palette.hex');
    writeFileSync(palette, '#000000\n#ffffff\n');
    const output = path.join(dir, 'jpeg.png');
    const result = run([
      'tests/reference/input-photo.jpg',
      output,
      '--width',
      '24',
      '--palette-in',
      palette,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const png = PNG.sync.read(readFileSync(output));
    assert.equal(png.width, 24);
    for (let i = 0; i < png.data.length; i += 4)
      assert.ok(png.data[i] === 0 || png.data[i] === 255);
    const invalid = path.join(dir, 'fake.gif');
    writeFileSync(invalid, 'GIF89a');
    assert.notEqual(run([invalid, path.join(dir, 'bad.png')]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
