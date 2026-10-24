import { PNG } from 'pngjs';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProcessor } from '@vael2196/crtvd';

const root = 'tests/reference';
const inputBytes = readFileSync(`${root}/input-scene.png`),
  input = PNG.sync.read(inputBytes);
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`));
assert.equal(
  createHash('sha256').update(inputBytes).digest('hex'),
  manifest.inputSha256,
  'Reference input changed; review fixtures explicitly',
);
const cases = JSON.parse(readFileSync(`${root}/cases.json`));
const processor = await createProcessor({
  wasmBinary: readFileSync('packages/core/lib/wasm/crtvd.wasm'),
});
const temporary = mkdtempSync(path.join(tmpdir(), 'crtvd-reference-'));
function compare(name, actual, expected) {
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  let different = 0,
    alpha = 0;
  const diff = new PNG({ width: actual.width, height: actual.height });
  for (let i = 0; i < actual.data.length; i += 4) {
    alpha += actual.data[i + 3] !== expected.data[i + 3];
    let changed = false;
    for (let c = 0; c < 3; c++) changed ||= Math.abs(actual.data[i + c] - expected.data[i + c]) > 2;
    different += changed;
    diff.data.set(changed ? [255, 0, 255, 255] : [0, 0, 0, 255], i);
  }
  if (alpha || different / (actual.width * actual.height) > 0.005) {
    mkdirSync('test-results/references', { recursive: true });
    writeFileSync(`test-results/references/${name}-diff.png`, PNG.sync.write(diff));
  }
  assert.equal(alpha, 0, `${name}: alpha changed`);
  assert.ok(
    different / (actual.width * actual.height) <= 0.005,
    `${name}: ${different} RGB pixels differ from the frozen image`,
  );
  console.log(`PASS ${name}: ${different} significant RGB pixel differences`);
}
try {
  for (const { name, options } of cases) {
    const expected = PNG.sync.read(readFileSync(`${root}/${name}.png`));
    const result = processor.processFrame(
      { data: input.data, width: input.width, height: input.height },
      options,
    );
    compare('wasm-' + name, result, expected);
    const file = path.join(temporary, name + '.png'),
      args = [`${root}/input-scene.png`, file];
    for (const [key, value] of Object.entries(options)) args.push('--' + key, String(value));
    const run = spawnSync(
      `build/native-release/crtvd${process.platform === 'win32' ? '.exe' : ''}`,
      args,
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    compare('native-' + name, PNG.sync.read(readFileSync(file)), expected);
  }
} finally {
  processor.dispose();
  rmSync(temporary, { recursive: true, force: true });
}
