import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import createCrtvd from '../web/public/wasm/crtvd.js';

const wasmBinary = await readFile(new URL('../web/public/wasm/crtvd.wasm', import.meta.url));
const engine = await createCrtvd({ wasmBinary });

function processImage(pixels, width, height, options = {}) {
  const o = {
    width,
    height,
    palette: 0,
    colours: 16,
    dither: 0,
    strength: 0.65,
    resample: 0,
    ...options,
  };
  const ptr = engine._malloc(pixels.length);
  assert.ok(ptr, 'input allocation');
  engine.HEAPU8.set(pixels, ptr);
  let handle = 0;
  try {
    handle = engine._crtvd_process(
      ptr,
      pixels.length,
      width,
      height,
      o.width,
      o.height,
      o.palette,
      o.colours,
      o.dither,
      o.strength,
      o.resample,
    );
    if (!handle) throw new Error(engine.UTF8ToString(engine._crtvd_last_error()));
    const p = engine._crtvd_result_pixels(handle),
      n = engine._crtvd_result_length(handle);
    const pp = engine._crtvd_result_palette(handle),
      pn = engine._crtvd_result_palette_length(handle);
    return { rgba: engine.HEAPU8.slice(p, p + n), palette: engine.HEAPU8.slice(pp, pp + pn) };
  } finally {
    if (handle) engine._crtvd_result_free(handle);
    engine._free(ptr);
  }
}

test('actual Wasm: weighted alpha filtering and palette result ABI', () => {
  const result = processImage(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1, { width: 1 });
  assert.deepEqual([...result.rgba], [255, 0, 0, 128]);
  assert.deepEqual([...result.palette], [255, 0, 0]);
});
test('actual Wasm: native reference black/white area average', () => {
  const r = processImage(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1, { width: 1 });
  assert.deepEqual([...r.rgba], [188, 188, 188, 255]);
});
test('actual Wasm: exceptions cross the API as readable errors and recover', () => {
  assert.throws(
    () => processImage(new Uint8Array([0, 0, 0, 255]), 1, 1, { width: 2 }),
    /must not exceed/,
  );
  assert.throws(
    () => processImage(new Uint8Array([0, 0, 0, 255]), 1, 1, { strength: NaN }),
    /strength/,
  );
  assert.deepEqual([...processImage(new Uint8Array([4, 8, 12, 255]), 1, 1).rgba], [4, 8, 12, 255]);
});
test('actual Wasm: repeated allocations release results and keep palette limits', () => {
  const image = new Uint8Array(64 * 32 * 4);
  for (let i = 0; i < image.length; i += 4) {
    image[i] = (i * 7) % 256;
    image[i + 1] = (i * 13) % 256;
    image[i + 2] = (i / 4) % 256;
    image[i + 3] = 255;
  }
  const heapSize = engine.HEAPU8.length;
  for (let run = 0; run < 100; run++) {
    const r = processImage(image, 64, 32, { width: 32, height: 16, dither: run % 3, colours: 8 });
    assert.equal(r.rgba.length, 32 * 16 * 4);
    assert.ok(r.palette.length <= 24);
    const palette = new Set();
    for (let j = 0; j < r.palette.length; j += 3)
      palette.add([...r.palette.slice(j, j + 3)].join(','));
    for (let j = 0; j < r.rgba.length; j += 4)
      assert.ok(palette.has([...r.rgba.slice(j, j + 3)].join(',')));
  }
  assert.equal(
    engine.HEAPU8.length,
    heapSize,
    'small repeated jobs should not continually grow the heap',
  );
});
