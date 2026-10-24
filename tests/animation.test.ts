import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readGif } from '../web/src/animation/gif';
import { gifWriter } from '../web/src/animation/encode';
import { flattenFrame } from '../web/src/animation/processor';
import { animationSize, validateOptions } from '../web/src/animation/limits';
import { DEFAULT_SETTINGS } from '../web/src/types';
import { fixtureGif } from './gif-fixtures';

async function decoded(bytes: Uint8Array<ArrayBuffer>) {
  const clip = readGif(bytes.buffer);
  const frames = [];
  for await (const frame of clip.frames(20)) frames.push({ ...frame, rgba: frame.rgba.slice() });
  return { clip, frames };
}
const rgba = (...colours: number[][]) => colours.flat();
const red = [255, 0, 0, 255],
  green = [0, 255, 0, 255],
  blue = [0, 0, 255, 255],
  clear = [0, 0, 0, 0],
  black = [0, 0, 0, 255];

test('GIF compositor applies partial offsets and restore-previous disposal', async () => {
  const { clip, frames } = await decoded(
    fixtureGif([
      { pixels: [1, 1, 1, 1, 1, 1], delay: 7 },
      { pixels: [2], width: 1, height: 1, left: 1, dispose: 3, delay: 13 },
      { pixels: [3], width: 1, height: 1, left: 2, delay: 20 },
    ]),
  );
  assert.equal(clip.info.repeat, 2);
  assert.equal(clip.info.frameCount, 3);
  assert.ok(Math.abs(clip.info.duration - 0.4) < 1e-8);
  assert.deepEqual([...frames[1].rgba.slice(0, 12)], rgba(red, green, red));
  assert.deepEqual([...frames[2].rgba.slice(0, 12)], rgba(red, red, blue));
  assert.equal(frames[1].timestamp, 0.07);
  assert.equal(frames[2].timestamp, 0.2);
});
test('GIF disposal 2 clears to transparent and preserves unaffected pixels', async () => {
  const { frames } = await decoded(
    fixtureGif([
      { pixels: [1, 1, 1, 1, 1, 1] },
      { pixels: [2], width: 1, height: 1, left: 1, dispose: 2 },
      { pixels: [3], width: 1, height: 1, left: 2 },
    ]),
  );
  assert.deepEqual([...frames[2].rgba.slice(0, 12)], rgba(red, clear, blue));
});
test('opaque GIF disposal 2 restores the logical background colour', async () => {
  const { frames } = await decoded(
    fixtureGif([
      { pixels: [1, 1, 1, 1, 1, 1], transparent: false },
      { pixels: [2], width: 1, height: 1, left: 1, dispose: 2, transparent: false },
      { pixels: [3], width: 1, height: 1, left: 2, transparent: false },
    ]),
  );
  assert.deepEqual([...frames[2].rgba.slice(0, 12)], rgba(red, black, blue));
});
test('transparent patches leave the previous image intact', async () => {
  const { frames } = await decoded(
    fixtureGif([{ pixels: [1, 1, 1, 1, 1, 1] }, { pixels: [0, 2, 0, 0, 0, 0] }]),
  );
  assert.deepEqual([...frames[1].rgba], rgba(red, green, red, red, red, red));
});
test('GIF frames honour their own local colour tables', async () => {
  const local = [
    [0, 0, 0],
    [0, 0, 255],
    [0, 255, 0],
    [255, 0, 0],
    [255, 255, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
  ];
  const { frames } = await decoded(
    fixtureGif([{ pixels: [1, 1, 1, 1, 1, 1] }, { pixels: [1, 1, 1, 1, 1, 1], palette: local }]),
  );
  assert.deepEqual([...frames[0].rgba.slice(0, 4)], red);
  assert.deepEqual([...frames[1].rgba.slice(0, 4)], blue);
});
test('interlaced rows are reconstructed in display order', async () => {
  const { frames } = await decoded(
    fixtureGif([{ pixels: [0, 4, 2, 6, 1, 3, 5, 7], interlaced: true }], 1, 8),
  );
  const expected = [
    [0, 0, 0, 0],
    red,
    green,
    blue,
    [255, 255, 255, 255],
    [255, 255, 0, 255],
    [255, 0, 255, 255],
    [0, 255, 255, 255],
  ];
  assert.deepEqual([...frames[0].rgba], rgba(...expected));
});
test('zero delays are normalised, and absent loop extensions remain absent', async () => {
  const { clip } = await decoded(fixtureGif([{ pixels: [1, 1, 1, 1, 1, 1], delay: 0 }], 3, 2, -1));
  assert.equal(clip.info.duration, 0.1);
  assert.equal(clip.info.repeat, -1);
});
test('GIF writer preserves timing and transparency with one global palette', async () => {
  const writer = gifWriter(2, 1, 0);
  const palette = new Uint8Array([255, 0, 0, 0, 0, 255]);
  await writer.add(new Uint8Array(rgba(red, clear)), palette, 0, 0.07);
  await writer.add(new Uint8Array(rgba(clear, blue)), palette, 0.07, 0.13);
  const { clip, frames } = await decoded(await writer.finish());
  assert.equal(clip.info.repeat, 0);
  assert.equal(clip.info.frameCount, 2);
  assert.equal(frames[0].duration, 0.07);
  assert.equal(frames[1].duration, 0.13);
  assert.deepEqual([...frames[0].rgba], rgba(red, clear));
  assert.deepEqual([...frames[1].rgba], rgba(clear, blue));
});
test('30 fps GIF timestamps are rounded without cumulative drift', async () => {
  const writer = gifWriter(1, 1, 0),
    palette = new Uint8Array([255, 0, 0]);
  for (let i = 0; i < 30; i++) await writer.add(new Uint8Array(red), palette, i / 30, 1 / 30);
  const { clip } = await decoded(await writer.finish());
  assert.ok(Math.abs(clip.info.duration - 1) < 1e-8);
});
test('video matting is in linear light and does not mutate borrowed GIF screens', () => {
  const pixels = new Uint8ClampedArray([255, 255, 255, 128]);
  const result = flattenFrame(
    { rgba: pixels, width: 1, height: 1, timestamp: 0, duration: 0.1 },
    '#000000',
  );
  assert.deepEqual([...pixels], [255, 255, 255, 128]);
  assert.deepEqual([...result.rgba], [188, 188, 188, 255]);
});
test('animation limits reject invalid durations, frames and settings', () => {
  assert.throws(() => readGif(new Uint8Array([1, 2, 3]).buffer), /not a GIF/);
  assert.throws(
    () => readGif(fixtureGif([{ pixels: [1, 1, 1, 1, 1, 1], delay: 3001 }]).buffer),
    /30 seconds/,
  );
  assert.throws(
    () => readGif(fixtureGif([{ pixels: [1], width: 1, height: 1, left: 4 }]).buffer),
    /outside/,
  );
  assert.throws(
    () => validateOptions({ settings: DEFAULT_SETTINGS, format: 'gif', fps: 99, matte: '#000000' }),
    /Invalid/,
  );
  assert.deepEqual(animationSize({ width: 1, height: 2000 }, 512), { width: 1, height: 2000 });
  const size = animationSize({ width: 1080, height: 1920 }, 512);
  assert.ok(size.width * size.height <= 512 * 512);
});
