import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPaletteChanges,
  decodePalette,
  editSwatch,
  encodePalette,
  fromHex,
  hex,
  hsvToRgb,
  quantisationPalette,
  remapPalette,
  rgbToHsv,
  suggestColours,
} from '../web/src/palettes';
import type { RGB } from '../web/src/palettes';
import { DEFAULT_SETTINGS } from '../web/src/types';
import {
  DEFAULT_EFFECTS,
  EffectRenderer,
  edgePoint,
  nearestEdge,
  separateEndpoint,
} from '../web/src/effects';
import { recommended, retro } from '../web/src/presets';

test('palette codes retain ordered RGB entries, reject malformed input and enforce GIF capacity', () => {
  assert.deepEqual(decodePalette(' CRTVD1:fe008a001177 '), [254, 0, 138, 0, 17, 119]);
  assert.equal(encodePalette([254, 0, 138, 0, 17, 119, 254, 0, 138]), 'CRTVD1:FE008A001177');
  for (const invalid of [
    '',
    'CRTVD2:000000',
    'CRTVD1:#000000',
    'CRTVD1:0000000',
    'CRTVD1:ABCDEFGH',
  ]) {
    assert.throws(() => decodePalette(invalid), /valid CRTVD1/);
  }
  const full = Array.from({ length: 256 }, (_, i) => [i, 0, 0]).flat();
  assert.equal(decodePalette(encodePalette(full)).length, 768);
  assert.throws(() => decodePalette(encodePalette(full), 255), /transparency/);
  assert.throws(() => decodePalette('CRTVD1:' + 'FFFFFF'.repeat(257)), /valid CRTVD1/);
});

test('swatch edits replace exact slots simultaneously and restore the chosen base', () => {
  const base = { ...DEFAULT_SETTINGS, customPalette: [255, 0, 0, 0, 0, 255] };
  const one = editSwatch(base, base.customPalette, 0, [0, 0, 255]);
  const edited = editSwatch(one, base.customPalette, 1, [255, 0, 0]);
  const pixels = new Uint8Array([255, 0, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0]);
  const output = remapPalette(edited.paletteEdit)(pixels);
  assert.deepEqual([...output], [0, 0, 255, 128, 255, 0, 0, 255, 0, 0, 0, 0]);
  assert.deepEqual([...pixels], [255, 0, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0]);
  assert.deepEqual(quantisationPalette(edited), new Uint8Array(base.customPalette));
  assert.deepEqual(
    quantisationPalette(clearPaletteChanges({ ...edited, importedPalette: [1, 2, 3] })),
    new Uint8Array(base.customPalette),
  );
});

test('wheel coordinates round trip and suggestions are deterministic distinct colours', () => {
  for (const text of [
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFFFF',
    '#A32D50',
    '#023B80',
    '#000000',
  ]) {
    assert.equal(hex(hsvToRgb(rgbToHsv(fromHex(text)!))), text);
  }
  const selected: RGB = [18, 44, 65],
    nearest: RGB = [19, 46, 67];
  const current: RGB[] = [selected, [255, 255, 255], nearest];
  const { nearby, paired, contrast } = suggestColours(selected, current);
  assert.deepEqual(nearby[0], nearest);
  assert.ok(paired.length && contrast.length);
  assert.equal(
    new Set([...current, ...paired, ...contrast].map(hex)).size,
    current.length + paired.length + contrast.length,
  );
  assert.deepEqual(suggestColours(selected, current), { nearby, paired, contrast });
});

test('all 18 retro presets and three original Soft Club / Y2K palettes are valid', () => {
  assert.equal(retro.length, 18);
  assert.equal(recommended.filter((preset) => preset.settings.customPalette).length, 3);
  for (const preset of [...recommended, ...retro]) {
    const colours = preset.settings.customPalette;
    if (colours) assert.deepEqual(decodePalette(encodePalette(colours)), colours);
  }
});

test('divider projects to all four edges, and endpoints cannot coincide', () => {
  assert.deepEqual(edgePoint(nearestEdge(0.4, 0.01, 400, 200)), [0.40000000000000036, 0]);
  assert.equal(edgePoint(nearestEdge(0.98, 0.5, 400, 200))[0], 1);
  assert.equal(edgePoint(nearestEdge(0.4, 0.99, 400, 200))[1], 1);
  assert.equal(edgePoint(nearestEdge(0.01, 0.5, 400, 200))[0], 0);
  assert.notEqual(separateEndpoint(0.125, 0.125), 0.125);
});

const solid = (w: number, h: number, rgba: number[]) =>
  Uint8Array.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]);

test('direct seams and swapped sides select actual source/result pixels', () => {
  const w = 8,
    h = 8;
  const source = solid(w, h, [255, 0, 0, 255]),
    converted = solid(w, h, [0, 0, 255, 255]);
  const renderer = new EffectRenderer(w, h, { ...DEFAULT_EFFECTS, blend: 'hard' });
  const result = renderer.apply(source, w, h, converted);
  assert.deepEqual([...result.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...result.slice((w - 1) * 4, w * 4)], [0, 0, 255, 255]);
  const flipped = new EffectRenderer(w, h, { ...DEFAULT_EFFECTS, blend: 'hard', flip: true });
  assert.deepEqual([...flipped.apply(source, w, h, converted).slice(0, 4)], [0, 0, 255, 255]);
  const horizontal = new EffectRenderer(w, h, {
    ...DEFAULT_EFFECTS,
    blend: 'hard',
    a: 0.375,
    b: 0.875,
  });
  const mixed = horizontal.apply(source, w, h, converted);
  assert.deepEqual([...mixed.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...mixed.slice(-4)], [0, 0, 255, 255]);
});

test('feather blends in premultiplied linear light without transparent colour bleed', () => {
  const w = 9,
    h = 9,
    centre = (4 * w + 4) * 4;
  const renderer = new EffectRenderer(w, h, { ...DEFAULT_EFFECTS, blend: 'feather', feather: 0.5 });
  const black = solid(w, h, [0, 0, 0, 255]),
    white = solid(w, h, [255, 255, 255, 255]);
  assert.deepEqual(
    [...renderer.apply(black, w, h, white).slice(centre, centre + 4)],
    [188, 188, 188, 255],
  );
  const transparentRed = solid(w, h, [255, 0, 0, 0]),
    blue = solid(w, h, [0, 0, 255, 255]);
  assert.deepEqual(
    [...renderer.apply(transparentRed, w, h, blue).slice(centre, centre + 4)],
    [0, 0, 255, 128],
  );
});

test('pyramid reconstructs identical input at odd sizes and softens a hard seam at multiple scales', () => {
  const w = 31,
    h = 17;
  const a = solid(w, h, [255, 0, 0, 255]),
    b = solid(w, h, [0, 0, 255, 255]);
  for (let i = 0; i < a.length; i += 4) a[i + 1] = (i * 13) % 256;
  const renderer = new EffectRenderer(w, h, { ...DEFAULT_EFFECTS, blend: 'pyramid' });
  assert.deepEqual(renderer.apply(a, w, h, a), a);
  const blended = renderer.apply(a, w, h, b);
  const center = (8 * w + 15) * 4;
  assert.ok(blended[center] > 0 && blended[center + 2] > 0);
  assert.ok(blended[center - 12] > 0 && blended[center - 10] > 0);
  assert.notDeepEqual(
    blended,
    new EffectRenderer(w, h, { ...DEFAULT_EFFECTS, blend: 'hard' }).apply(a, w, h, b),
  );
});

test('chromatic displacement and purple halo change highlight edges but preserve alpha', () => {
  const w = 32,
    h = 12;
  const input = solid(w, h, [30, 30, 30, 255]);
  for (let y = 0; y < h; y++)
    for (let x = 4; x < 8; x++) input.set([255, 255, 255, 255], (y * w + x) * 4);
  input.set([0, 0, 0, 0], 0);
  for (const e of [{ aberration: 1 }, { purple: 1 }]) {
    const out = new EffectRenderer(w, h, { ...DEFAULT_EFFECTS, ...e }).apply(input, w, h, input);
    assert.notDeepEqual(out, input);
    for (let i = 3; i < out.length; i += 4) assert.equal(out[i], input[i]);
    assert.ok(out.some((n, i) => i % 4 === 0 && n !== out[i + 1]));
  }
});
