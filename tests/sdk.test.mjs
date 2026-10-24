import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProcessor, VERSION } from '@vael2196/crtvd';
const create = () =>
  createProcessor({ wasmBinary: readFileSync('packages/core/lib/wasm/crtvd.wasm') });
const red = { data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 };
test('SDK returns owned buffers and supports independent processor instances', async () => {
  assert.equal(VERSION, '0.3.0');
  const a = await create(),
    b = await create();
  try {
    const first = a.processFrame(red, { dither: 'none' });
    a.processFrame({ data: new Uint8Array([0, 0, 255, 255]), width: 1, height: 1 });
    assert.deepEqual([...first.data], [255, 0, 0, 255]);
    assert.deepEqual([...b.processFrame(red).data], [255, 0, 0, 255]);
    assert.ok(first.processingMs >= 0 && first.totalMs >= first.processingMs);
  } finally {
    a.dispose();
    b.dispose();
  }
});
test('SDK trains and reuses a palette, with explicit lifecycle checks', async () => {
  const engine = await create();
  const trainer = engine.createPaletteTrainer({ width: 1, height: 1 });
  trainer.addFrame(red, 0.1);
  trainer.addFrame({ data: new Uint8Array([0, 0, 255, 255]), width: 1, height: 1 }, 0.2);
  const palette = trainer.finish(2);
  assert.equal(palette.length, 6);
  assert.deepEqual(
    [...engine.processFrame(red, { customPalette: palette, dither: 'none' }).data],
    [255, 0, 0, 255],
  );
  engine.dispose();
  engine.dispose();
  trainer.dispose();
  assert.throws(() => engine.processFrame(red), /disposed/);
  assert.throws(() => trainer.finish(), /disposed/);
});
test('SDK rejects malformed frames, modes, custom palettes and invalid durations', async () => {
  const engine = await create();
  const trainer = engine.createPaletteTrainer();
  try {
    assert.throws(() => engine.processFrame({ ...red, data: new Uint8Array(3) }), /RGBA8/);
    assert.throws(() => engine.processFrame(red, { width: 2 }), /Output width/);
    assert.throws(() => engine.processFrame(red, { palette: 'toString' }), /mode/);
    assert.throws(() => engine.processFrame(red, { customPalette: new Uint8Array(2) }), /triplets/);
    assert.throws(() => trainer.addFrame(red, NaN), /duration/);
  } finally {
    engine.dispose();
  }
});
