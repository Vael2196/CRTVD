import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import createCrtvd from '../web/public/wasm/crtvd.js';

const wasmBinary = await readFile(new URL('../web/public/wasm/crtvd.wasm', import.meta.url));
const engine = await createCrtvd({ wasmBinary });

test('actual Wasm: duration-weighted clip palette trainer and custom palette API', () => {
  const pointer = engine._malloc(4),
    trainer = engine._crtvd_palette_create();
  let paletteResult = 0,
    result = 0,
    palettePointer = 0;
  try {
    assert.ok(trainer);
    engine.HEAPU8.set([255, 0, 0, 255], pointer);
    assert.equal(engine._crtvd_palette_add(trainer, pointer, 4, 1, 1, 1, 1, 0, 0.1), 1);
    engine.HEAPU8.set([0, 0, 255, 255], pointer);
    assert.equal(engine._crtvd_palette_add(trainer, pointer, 4, 1, 1, 1, 1, 0, 0.2), 1);
    paletteResult = engine._crtvd_palette_finish(trainer, 2);
    assert.ok(paletteResult);
    const p = engine._crtvd_result_palette(paletteResult),
      n = engine._crtvd_result_palette_length(paletteResult);
    const palette = engine.HEAPU8.slice(p, p + n);
    assert.equal(n, 6);
    palettePointer = engine._malloc(n);
    engine.HEAPU8.set(palette, palettePointer);
    result = engine._crtvd_process_palette(
      pointer,
      4,
      1,
      1,
      1,
      1,
      0,
      16,
      0,
      1,
      0,
      palettePointer,
      n,
    );
    assert.ok(result);
    const out = engine._crtvd_result_pixels(result);
    assert.deepEqual([...engine.HEAPU8.slice(out, out + 4)], [0, 0, 255, 255]);
    assert.equal(engine._crtvd_palette_add(trainer, pointer, 4, 1, 1, 1, 1, 0, NaN), 0);
    assert.match(engine.UTF8ToString(engine._crtvd_last_error()), /duration/);
  } finally {
    if (result) engine._crtvd_result_free(result);
    if (paletteResult) engine._crtvd_result_free(paletteResult);
    if (palettePointer) engine._free(palettePointer);
    engine._crtvd_palette_free(trainer);
    engine._free(pointer);
  }
});

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
