import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { fixtureGif } from './gif-fixtures';
import { readGif } from '../web/src/animation/gif';

const exportButton = (page: Page) => page.getByRole('button', { name: 'Export PNG' });
const convertButton = (page: Page) =>
  page.getByRole('button', { name: 'Convert animation', exact: true });
const defaultButton = (page: Page) => page.getByRole('button', { name: 'Default palette' });
const swatch = (page: Page, colour: string) =>
  page.getByRole('button', { name: new RegExp(`^Edit colour .*: ${colour}$`) });

async function image(page: Page, mode: 'colour' | 'white' | 'contrast' = 'colour') {
  await page.goto('./');
  const png = new PNG({ width: 65, height: 33 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data.set(
      mode === 'white' || (mode === 'contrast' && (i / 4) % 65 < 16)
        ? [255, 255, 255, 255]
        : mode === 'contrast'
          ? [0, 0, 0, 255]
          : (i / 4) % 65 < 32
            ? [255, 0, 0, 128]
            : [0, 0, 255, 255],
      i,
    );
  }
  await page.getByLabel('Upload image').setInputFiles({
    name: 'creative.png',
    mimeType: 'image/png',
    buffer: PNG.sync.write(png),
  });
  await expect(page.getByText('creative.png', { exact: true })).toBeVisible();
  await expect(exportButton(page)).toBeEnabled();
}

async function importCode(page: Page, code: string) {
  await page.getByRole('button', { name: 'Import / export palette' }).click();
  await page.getByLabel('Import code').fill(code);
  await page.getByRole('button', { name: 'Apply palette' }).click();
}

async function editColour(page: Page, old: string, colour: string) {
  await swatch(page, old).click();
  await expect(page.getByRole('dialog', { name: 'Change colour' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggested colours' })).toBeVisible();
  await page.getByLabel('Hex', { exact: true }).fill(colour);
  await page.getByRole('button', { name: 'Apply colour' }).click();
}

async function downloaded(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportPng(page: Page) {
  await expect(exportButton(page)).toBeEnabled();
  const event = page.waitForEvent('download');
  await exportButton(page).click();
  return PNG.sync.read(await downloaded(await event));
}

async function exportGif(page: Page) {
  const link = page.getByRole('link', { name: 'Download GIF' });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const event = page.waitForEvent('download');
  await link.click();
  const bytes = Uint8Array.from(await downloaded(await event));
  const clip = readGif(bytes.buffer);
  const frames: number[][] = [];
  for await (const frame of clip.frames(20)) frames.push(Array.from(frame.rgba));
  return { clip, frames };
}

const pixel = (png: PNG, x: number, y: number) =>
  Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));

test('editing a swatch changes exported pixels while Default restores the initial image palette', async ({
  page,
}) => {
  await image(page);
  const initial = await exportPng(page);
  await expect(defaultButton(page)).toHaveCount(0);
  await editColour(page, '#FF0000', '#00FF00');
  await expect(defaultButton(page)).toBeVisible();
  const edited = await exportPng(page);
  expect(pixel(edited, 2, 2)).toEqual([0, 255, 0, 128]);
  expect(pixel(edited, 62, 2)).toEqual([0, 0, 255, 255]);
  await defaultButton(page).click();
  await expect(defaultButton(page)).toHaveCount(0);
  expect((await exportPng(page)).data).toEqual(initial.data);
});

test('preset gallery expands, and local palette codes round trip without storing data', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') outside.push(url.hostname);
  });
  await image(page);
  await page.getByRole('button', { name: /Cross Section/ }).click();
  await expect(swatch(page, '#E7462D')).toBeEnabled();
  await expect(page.getByRole('button', { name: /Console Night/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 18 retro console palettes' }).click();
  await page.getByRole('button', { name: /Console Night/ }).click();
  await expect(swatch(page, '#6A1B9A')).toBeEnabled();
  await page.getByRole('button', { name: 'Import / export palette' }).click();
  const code = await page.getByLabel('Export code').inputValue();
  expect(code).toBe('CRTVD1:6A1B9AFF6F2000BCD4F5F5F5212121');
  await page.getByLabel('Import code').fill('invalid');
  await page.getByRole('button', { name: 'Apply palette' }).click();
  await expect(page.getByRole('alert')).toContainText('valid CRTVD1');
  await page.getByLabel('Import code').fill(code);
  await page.getByRole('button', { name: 'Apply palette' }).click();
  await expect(defaultButton(page)).toBeEnabled();
  await expect(swatch(page, '#6A1B9A')).toBeEnabled();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(outside).toEqual([]);
});

test('direct, feather and pyramid blends affect exported PNGs and both divider endpoints move', async ({
  page,
}) => {
  await image(page, 'white');
  await importCode(page, 'CRTVD1:000000');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Blend with source').selectOption('hard');
  const hard = await exportPng(page);
  expect(pixel(hard, 0, 16)).toEqual([255, 255, 255, 255]);
  expect(pixel(hard, 64, 16)).toEqual([0, 0, 0, 255]);
  await page.getByLabel('Blend with source').selectOption('feather');
  const feather = await exportPng(page);
  expect(pixel(feather, 32, 16)).toEqual([188, 188, 188, 255]);
  await page.getByLabel('Blend with source').selectOption('pyramid');
  const multi = await exportPng(page);
  expect(pixel(multi, 32, 16)[0]).toBeGreaterThan(0);
  expect(pixel(multi, 32, 16)[0]).toBeLessThan(255);
  expect(multi.data).not.toEqual(feather.data);
  await page.getByRole('button', { name: 'Horizontal seam' }).click();
  const line = page.locator('.blend-handles line');
  await expect(line).toHaveAttribute('y1', '50');
  await expect(line).toHaveAttribute('y2', '50');
  const a = page.getByRole('slider', { name: 'Blend endpoint A' });
  const b = page.getByRole('slider', { name: 'Blend endpoint B' });
  await a.press('ArrowRight');
  await b.press('ArrowLeft');
  await expect(line).not.toHaveAttribute('y1', '50');
  await expect(line).not.toHaveAttribute('y2', '50');
  await a.scrollIntoViewIfNeeded();
  const start = (await a.boundingBox())!;
  const bounds = (await page.getByRole('group', { name: 'Blend divider' }).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect(line).toHaveAttribute('y1', '0');
  await expect(line).not.toHaveAttribute('x1', '100');
  await expect(exportButton(page)).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('GIF swatches re-encode the clip, and the advanced preview and export apply the divider', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const fixture = fixtureGif(
    [
      { pixels: Array(48).fill(1), delay: 7 },
      { pixels: Array(48).fill(3), delay: 13 },
    ],
    8,
    6,
  );
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'creative.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(fixture),
  });
  await expect(convertButton(page)).toBeEnabled();
  await convertButton(page).click();
  await expect(swatch(page, '#0000FF')).toBeEnabled();
  await page.getByRole('button', { name: 'Preview first frame' }).click();
  await expect(page.getByLabel('Converted first frame')).toBeVisible();
  // Blue only occurs in frame two. A preview after training retains it.
  await expect(swatch(page, '#0000FF')).toBeEnabled();
  await importCode(page, 'CRTVD1:FF00000000FF');
  await convertButton(page).click();
  await expect(page.getByRole('link', { name: 'Download GIF' })).toBeVisible();
  await editColour(page, '#FF0000', '#00FF00');
  const edited = await exportGif(page);
  expect(edited.frames.map((frame) => frame.slice(0, 4))).toEqual([
    [0, 255, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(edited.clip.info.duration).toBeCloseTo(0.2);
  expect(edited.clip.info.repeat).toBe(2);
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Blend with source').selectOption('hard');
  await page.getByRole('button', { name: 'Preview first frame' }).click();
  const canvas = page.getByLabel('Converted first frame');
  await expect(canvas).toBeVisible();
  expect(
    await canvas.evaluate((node: HTMLCanvasElement) =>
      Array.from(node.getContext('2d')!.getImageData(0, 0, 1, 1).data),
    ),
  ).toEqual([255, 0, 0, 255]);
  await expect(page.getByRole('link', { name: 'Download GIF' })).toHaveCount(0);
  await convertButton(page).click();
  const blended = await exportGif(page);
  expect(blended.frames[0].slice(0, 4)).toEqual([255, 0, 0, 255]);
  expect(blended.frames[0].slice(28, 32)).toEqual([0, 255, 0, 255]);
  expect(blended.clip.info.duration).toBeCloseTo(0.2);
  await page.getByLabel('Blend with source').selectOption('pyramid');
  await convertButton(page).click();
  const softened = await exportGif(page);
  expect(softened.frames[0]).not.toEqual(blended.frames[0]);
  expect(softened.clip.info.duration).toBeCloseTo(0.2);
  expect(softened.clip.info.repeat).toBe(2);
  await defaultButton(page).click();
  await expect(defaultButton(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download GIF' })).toBeVisible();
});

test('chromatic aberration and purple fringing reach the PNG rather than only the preview', async ({
  page,
}) => {
  await image(page, 'contrast');
  const original = await exportPng(page);
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  const aberration = page.getByRole('slider', { name: 'Chromatic aberration' });
  const purple = page.getByRole('slider', { name: 'Purple fringing' });
  await aberration.press('End');
  await expect(aberration).toHaveValue('100');
  const split = await exportPng(page);
  expect(split.data).not.toEqual(original.data);
  await aberration.press('Home');
  await purple.press('End');
  await expect(purple).toHaveValue('100');
  const tinted = await exportPng(page);
  const [r, g, b, alpha] = pixel(tinted, 16, 16);
  expect(b).toBeGreaterThan(r);
  expect(r).toBeGreaterThan(g);
  expect(alpha).toBe(255);
  for (const result of [split, tinted]) {
    expect(result.data.filter((_, i) => i % 4 === 3)).toEqual(
      original.data.filter((_, i) => i % 4 === 3),
    );
  }
});
