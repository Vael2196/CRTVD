import { test, expect } from '@playwright/test';
import type { Page, Download } from '@playwright/test';
import { readGif } from '../web/src/animation/gif';
import { makeDemoGif } from '../web/src/animation/demo';
import { fixtureGif } from './gif-fixtures';
import { Input, BufferSource, WEBM, MP4 } from 'mediabunny';

async function editor(page: Page) {
  await page.goto('./');
  await expect(
    page.getByRole('button', { name: 'Animation', exact: true }),
    'Animation navigation missing: check the served build and TEST_BASE_URL',
  ).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Give every frame');
}
async function bytes(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}
async function downloadResult(page: Page, name: string) {
  const link = page.getByRole('link', { name: `Download ${name}` });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const pending = page.waitForEvent('download');
  await link.click();
  return bytes(await pending);
}
async function sample(page: Page) {
  await page.getByRole('button', { name: 'Try the moving landscape' }).click();
  await expect(page.getByText('moving-dusk.gif', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convert animation', exact: true })).toBeEnabled();
}

test('animated GIF uses one C++ palette, preserves timing and downloads real frames', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await editor(page);
  await sample(page);
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  const data = await downloadResult(page, 'GIF');
  const clip = readGif(data.buffer);
  expect(clip.info.width).toBe(160);
  expect(clip.info.height).toBe(107);
  expect(clip.info.frameCount).toBe(12);
  expect(clip.info.duration).toBeCloseTo(1.2, 6);
  expect(clip.info.repeat).toBe(0);
  const colours = new Set<string>();
  const frames = new Set<string>();
  for await (const frame of clip.frames(20)) {
    frames.add(Buffer.from(frame.rgba).toString('base64'));
    for (let i = 0; i < frame.rgba.length; i += 4)
      if (frame.rgba[i + 3]) colours.add([...frame.rgba.slice(i, i + 3)].join(','));
  }
  expect(colours.size).toBeLessThanOrEqual(16);
  expect(frames.size).toBeGreaterThan(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Dithering', { exact: true }).selectOption('none');
  await expect(page.getByRole('link', { name: 'Download GIF' })).toHaveCount(0);
});

test('real GIF pipeline preserves disposal, partial patches and original delays', async ({
  page,
}) => {
  await editor(page);
  const input = fixtureGif([
    { pixels: [1, 1, 1, 1, 1, 1], delay: 7 },
    { pixels: [2], width: 1, height: 1, left: 1, dispose: 3, delay: 13 },
    { pixels: [3], width: 1, height: 1, left: 2, delay: 20 },
  ]);
  await page
    .getByLabel('Upload animation')
    .setInputFiles({ name: 'disposal.gif', mimeType: 'image/gif', buffer: Buffer.from(input) });
  await expect(page.getByText('disposal.gif', { exact: true })).toBeVisible();
  await page.getByLabel('Dithering', { exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  const data = await downloadResult(page, 'GIF');
  const clip = readGif(data.buffer);
  const frames = [];
  for await (const frame of clip.frames(20)) frames.push({ ...frame, rgba: frame.rgba.slice() });
  expect(clip.info.repeat).toBe(2);
  expect(clip.info.duration).toBeCloseTo(0.4, 6);
  expect(frames.map((f) => f.duration)).toEqual([0.07, 0.13, 0.2]);
  expect([...frames[2].rgba.slice(0, 12)]).toEqual([
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255,
  ]);
});

test('video input -> GIF and WebM output use real browser decoding and encoding', async ({
  page,
}) => {
  await editor(page);
  const fixture = await page.evaluate(async () => {
    if (!('MediaRecorder' in window) || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))
      return null;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = `hsl(${i * 40} 70% 50%)`;
      ctx.fillRect(0, 0, 96, 64);
      ctx.fillStyle = '#fff';
      ctx.fillRect(i * 8, 10, 12, 12);
      await new Promise((r) => setTimeout(r, 85));
    }
    recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    const buffer = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  });
  test.skip(!fixture, 'This Chromium build has no VP8 recorder.');
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'moving.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(fixture!, 'base64'),
  });
  await expect(page.getByText('moving.webm', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  const gif = await downloadResult(page, 'GIF');
  expect(readGif(gif.buffer).info.frameCount).toBeGreaterThan(1);
  await page.getByLabel('Output format', { exact: true }).selectOption('webm');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  const webm = await downloadResult(page, 'WEBM');
  const input = new Input({ formats: [WEBM], source: new BufferSource(webm) });
  try {
    const track = await input.getPrimaryVideoTrack();
    expect(await track!.getCodec()).toBe('vp8');
    expect(await track!.getDisplayWidth()).toBe(96);
    expect(await input.getAudioTracks()).toHaveLength(0);
    expect(await track!.computeDuration()).toBeGreaterThan(0.1);
  } finally {
    input.dispose();
  }
});

test('H.264 export pads odd height and is accepted again as MP4 input', async ({ page }) => {
  await editor(page);
  await sample(page);
  const supports = await page.evaluate(async () => {
    if (typeof VideoEncoder === 'undefined') return false;
    try {
      return (
        (
          await VideoEncoder.isConfigSupported({
            codec: 'avc1.42001f',
            width: 160,
            height: 108,
            bitrate: 3_000_000,
            framerate: 20,
          })
        ).supported ?? false
      );
    } catch {
      return false;
    }
  });
  test.skip(!supports, 'This Chromium build does not offer an H.264 encoder.');
  await page.getByLabel('Output format', { exact: true }).selectOption('mp4');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  const mp4 = await downloadResult(page, 'MP4');
  const input = new Input({ formats: [MP4], source: new BufferSource(mp4) });
  try {
    const track = await input.getPrimaryVideoTrack();
    expect(await track!.getCodec()).toBe('avc');
    expect(await track!.getDisplayWidth()).toBe(160);
    expect(await track!.getDisplayHeight()).toBe(108);
  } finally {
    input.dispose();
  }
  await page
    .getByLabel('Upload animation')
    .setInputFiles({ name: 'roundtrip.mp4', mimeType: 'video/mp4', buffer: Buffer.from(mp4) });
  await expect(page.getByText('roundtrip.mp4', { exact: true })).toBeVisible();
  await page.getByLabel('Output format', { exact: true }).selectOption('gif');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  const gif = await downloadResult(page, 'GIF');
  expect(readGif(gif.buffer).info.frameCount).toBeGreaterThan(1);
});

test('cancellation terminates conversion and the next job can still succeed', async ({ page }) => {
  await editor(page);
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'long.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(makeDemoGif(200)),
  });
  await expect(page.getByText('long.gif', { exact: true })).toBeVisible();
  await page.getByLabel('Maximum colours', { exact: true }).selectOption('256');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Convert animation', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Download GIF' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await sample(page);
  await page.getByLabel('Maximum colours', { exact: true }).selectOption('16');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download GIF' })).toBeVisible();
});

test('long clips are rejected and switching back preserves the still-image workflow', async ({
  page,
}) => {
  await editor(page);
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'long.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(fixtureGif([{ pixels: [1, 1, 1, 1, 1, 1], delay: 3100 }])),
  });
  await expect(page.getByRole('alert')).toContainText('30 seconds');
  await page.getByRole('button', { name: 'Still image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
});
