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
  await page.getByRole('button', { name: /Anime Orange & Green/ }).click();
  await expect(swatch(page, '#D74D38')).toBeEnabled();
  await page.getByRole('button', { name: /Sega CD Weirdcore/ }).click();
  await expect(swatch(page, '#4E2A5B')).toBeEnabled();
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

test('blur, swatch targeting and ASCII are applied to the downloaded PNG', async ({ page }) => {
  await image(page, 'contrast');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Blur type').selectOption('gaussian');
  await page.getByRole('slider', { name: 'Blur radius' }).press('End');
  const blurred = await exportPng(page);
  expect(pixel(blurred, 16, 16)[0]).toBeGreaterThan(0);
  expect(pixel(blurred, 15, 16)[0]).toBeLessThan(255);

  await page.getByLabel('Apply effects to').selectOption('except');
  const black = page
    .getByRole('group', { name: 'Colours for effect targeting' })
    .getByRole('button', { name: '#000000' });
  await black.click();
  await expect(black).toHaveAttribute('aria-pressed', 'true');
  const locked = await exportPng(page);
  expect(pixel(locked, 16, 16)).toEqual([0, 0, 0, 255]);
  expect(pixel(locked, 15, 16)).toEqual(pixel(blurred, 15, 16));

  await page.getByLabel('Apply effects to').selectOption('only');
  const only = await exportPng(page);
  expect(pixel(only, 16, 16)).toEqual(pixel(blurred, 16, 16));
  expect(pixel(only, 15, 16)).toEqual([255, 255, 255, 255]);

  await page.getByLabel('Apply effects to').selectOption('all');
  await page.getByLabel('Blur type').selectOption('off');
  await page.getByLabel('Render as ASCII').check();
  await page.getByLabel('ASCII symbols').selectOption('custom');
  await page.getByLabel('Custom ASCII characters').fill('A');
  await page.getByLabel('ASCII cell size').fill('8');
  const ascii = await exportPng(page);
  expect(pixel(ascii, 1, 0)).toEqual([0, 0, 0, 255]);
  expect(pixel(ascii, 2, 0)).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Reset effects' }).click();
  expect(pixel(await exportPng(page), 1, 0)).toEqual([255, 255, 255, 255]);
});

test('ASCII and colour targeting reach GIF downloads without changing the loop or delays', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const w = 16,
    h = 8;
  const clip = fixtureGif(
    [4, 3].map((index, i) => ({
      pixels: Array.from({ length: w * h }, (_, p) => (p % w < 8 ? 1 : index)),
      delay: i === 0 ? 7 : 13,
    })),
    w,
    h,
  );
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'ascii.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(clip),
  });
  await expect(convertButton(page)).toBeEnabled();
  await importCode(page, 'CRTVD1:FF0000FFFFFF0000FF000000');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Apply effects to').selectOption('except');
  await page
    .getByRole('group', { name: 'Colours for effect targeting' })
    .getByRole('button', { name: '#FF0000' })
    .click();
  await page.getByLabel('Render as ASCII').check();
  await page.getByLabel('ASCII symbols').selectOption('custom');
  await page.getByLabel('Custom ASCII characters').fill('A');
  await page.getByLabel('ASCII cell size').fill('8');
  await convertButton(page).click();
  const gif = await exportGif(page);
  expect(gif.frames.map((frame) => frame.slice(0, 4))).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  expect(gif.frames[0].slice(8 * 4, 9 * 4)).toEqual([0, 0, 0, 255]);
  expect(gif.frames[0].slice(10 * 4, 11 * 4)).toEqual([255, 255, 255, 255]);
  expect(gif.frames[1].slice(10 * 4, 11 * 4)).toEqual([0, 0, 255, 255]);
  expect(gif.clip.info.duration).toBeCloseTo(0.2);
  expect(gif.clip.info.repeat).toBe(2);
});

test('preview picking toggles a palette slot and its curve persists through recolouring', async ({
  page,
}) => {
  await image(page, 'contrast');
  await importCode(page, 'CRTVD1:000000FFFFFF');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Apply effects to').selectOption('only');
  await page.getByRole('button', { name: 'Pick colours on preview' }).click();
  const targets = page.getByRole('group', { name: 'Colours for effect targeting' });
  const preview = page.getByLabel('Converted image preview');
  const click = async () => {
    await expect(exportButton(page)).toBeEnabled();
    const bounds = (await preview.boundingBox())!;
    await preview.click({ position: { x: bounds.width * 0.77, y: bounds.height * 0.5 } });
  };
  await click();
  await expect(targets.getByRole('button', { name: '#000000' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await click();
  await expect(targets.getByRole('button', { name: '#000000' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await click();
  await page.getByRole('button', { name: 'Edit curves' }).click();
  await page.getByLabel('Curve channel').selectOption('green');
  await page.getByLabel('Output level').fill('128');
  expect(pixel(await exportPng(page), 42, 12)).toEqual([0, 128, 0, 255]);
  await editColour(page, '#000000', '#140020');
  await expect(targets.getByRole('button', { name: '#140020' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(pixel(await exportPng(page), 42, 12)).toEqual([20, 128, 32, 255]);
  await importCode(page, 'CRTVD1:150031FFFFFF');
  await expect(targets.getByRole('button', { name: '#150031' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(pixel(await exportPng(page), 42, 12)).toEqual([21, 128, 49, 255]);
});

test('shaped masks and drawing on the preview use the same geometry in PNG export', async ({
  page,
}) => {
  await image(page, 'white');
  await importCode(page, 'CRTVD1:000000');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Blend with source').selectOption('hard');
  await page.getByRole('button', { name: 'Rising diagonal' }).click();
  const rising = await exportPng(page);
  await page.getByRole('button', { name: 'Falling diagonal' }).click();
  expect((await exportPng(page)).data).not.toEqual(rising.data);
  await page.getByRole('combobox', { name: 'Blend shape', exact: true }).selectOption('ellipse');
  const circle = await exportPng(page);
  expect(pixel(circle, 32, 16)[0]).toBe(255);
  expect(pixel(circle, 2, 2)[0]).toBe(0);
  await page.getByRole('combobox', { name: 'Blend shape', exact: true }).selectOption('rectangle');
  await page.getByLabel('Mask width').fill('70');
  await page.getByLabel('Mask height').fill('30');
  const rectangle = await exportPng(page);
  await page.getByLabel('Mask rotation').fill('45');
  expect((await exportPng(page)).data).not.toEqual(rectangle.data);
  await page.getByRole('combobox', { name: 'Blend shape', exact: true }).selectOption('curve');
  const curved = await exportPng(page);
  await page.getByRole('button', { name: 'Curve bend handle' }).press('Shift+ArrowLeft');
  expect((await exportPng(page)).data).not.toEqual(curved.data);
  await page.getByRole('combobox', { name: 'Blend shape', exact: true }).selectOption('freehand');
  const surface = page.getByRole('region', { name: 'Draw blend outline' });
  await surface.scrollIntoViewIfNeeded();
  const r = (await surface.boundingBox())!;
  const move = (x: number, y: number) =>
    page.mouse.move(r.x + x * r.width, r.y + y * r.height, { steps: 4 });
  await move(0.27, 0.28);
  await page.mouse.down();
  await move(0.7, 0.28);
  await move(0.7, 0.7);
  await move(0.27, 0.7);
  await move(0.27, 0.29);
  await page.mouse.up();
  const lasso = await exportPng(page);
  expect(pixel(lasso, 32, 16)[0]).toBe(255);
  expect(pixel(lasso, 4, 4)[0]).toBe(0);
});

test('animation picker can select a later GIF frame and transfers the resulting grade to export', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const clip = fixtureGif(
    [
      { pixels: Array(128).fill(1), delay: 10 },
      { pixels: Array(128).fill(3), delay: 20 },
    ],
    16,
    8,
  );
  await page
    .getByLabel('Upload animation')
    .setInputFiles({ name: 'picker.gif', mimeType: 'image/gif', buffer: Buffer.from(clip) });
  await expect(convertButton(page)).toBeEnabled();
  await importCode(page, 'CRTVD1:FF00000000FF');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Apply effects to').selectOption('only');
  await page.getByRole('button', { name: 'Pick colours on preview' }).click();
  const timeline = page.getByLabel('Colour picking time');
  await expect(timeline).toBeEnabled();
  await timeline.fill('0.15');
  await page.getByRole('button', { name: 'Show frame at 0.15 s' }).click();
  const canvas = page.getByLabel('Converted first frame');
  await expect(canvas).toBeVisible();
  await expect(page.getByText('Showing 0.15 s', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Array.from(c.getContext('2d')!.getImageData(0, 0, 1, 1).data),
      ),
    )
    .toEqual([0, 0, 255, 255]);
  await canvas.click();
  await expect(
    page
      .getByRole('group', { name: 'Colours for effect targeting' })
      .getByRole('button', { name: '#0000FF' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Stop picking colours' }).click();
  await page.getByRole('button', { name: 'Edit curves' }).click();
  await page.getByLabel('Curve channel').selectOption('green');
  await page.getByLabel('Output level').fill('255');
  await convertButton(page).click();
  const gif = await exportGif(page);
  expect(gif.frames.map((frame) => frame.slice(0, 4))).toEqual([
    [255, 0, 0, 255],
    [0, 255, 255, 255],
  ]);
  expect(gif.clip.info.duration).toBeCloseTo(0.3);
});

test('layer masks preserve source detail and show live original and graded colours', async ({
  page,
}) => {
  await image(page, 'contrast');
  await importCode(page, 'CRTVD1:000000');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByRole('button', { name: 'Enable layer stack' }).click();
  await page.getByRole('button', { name: 'Show Original' }).click();
  await page.getByRole('button', { name: 'Add mask', exact: true }).click();
  await page.getByRole('combobox', { name: 'Blend shape', exact: true }).selectOption('rectangle');
  await page.getByRole('button', { name: 'Add mask', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Active mask', exact: true }).locator('option'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove mask', exact: true }).click();
  await page.getByRole('button', { name: 'Remove mask', exact: true }).click();
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await page.getByRole('button', { name: 'Edit curves' }).click();
  await page.getByLabel('Curve channel').selectOption('green');
  await page.getByLabel('Output level').fill('128');
  const visible = page.getByRole('group', { name: 'Colours in the preview' });
  await expect(visible.getByRole('img', { name: '#008000' })).toBeVisible();
  expect(pixel(await exportPng(page), 30, 16)).toEqual([0, 128, 0, 255]);
  await page.getByRole('button', { name: 'Hide Adjustment' }).click();
  await page.getByRole('button', { name: 'Move Original down' }).click();
  const converted = await exportPng(page);
  expect(pixel(converted, 2, 2)).toEqual([0, 0, 0, 255]);
  await page.getByRole('button', { name: 'Move Original up' }).click();
  await expect(visible.getByRole('img', { name: '#FFFFFF' })).toBeVisible();
  await page.getByLabel('Output width').fill('32');
  expect((await exportPng(page)).width).toBe(32);
  await page.getByLabel('Apply selected resolution to original').uncheck();
  expect((await exportPng(page)).width).toBe(65);
  const preview = page.locator('.pinned-preview');
  await page.getByRole('button', { name: 'Add adjustment layer' }).scrollIntoViewIfNeeded();
  const box = (await preview.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(0);
  expect(box.y).toBeLessThan(await page.evaluate(() => innerHeight));
});

test('palette grouping can edit relatives and unify their average in PNG export', async ({
  page,
}) => {
  await image(page, 'contrast');
  await importCode(page, 'CRTVD1:202040303060');
  await page.getByRole('button', { name: 'Organise colours' }).click();
  await page.getByLabel('Number of groups').fill('1');
  await page.getByRole('button', { name: /Edit group 1/ }).click();
  await page.getByLabel('Hex', { exact: true }).fill('#33704F');
  await page.getByRole('button', { name: 'Apply colour' }).click();
  const split = await exportPng(page);
  expect(pixel(split, 2, 2)).not.toEqual(pixel(split, 45, 2));
  await page.getByRole('button', { name: 'Flat palette' }).click();
  await page.getByRole('button', { name: 'Unify colours', exact: true }).click();
  await page.getByRole('button', { name: 'Select all colours' }).click();
  await page.getByRole('button', { name: 'Apply average colour' }).click();
  const merged = await exportPng(page);
  expect(pixel(merged, 2, 2)).toEqual(pixel(merged, 45, 2));
});

test('the animation worker previews and exports a layered clip at source dimensions', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const w = 32,
    h = 16;
  const file = fixtureGif(
    [1, 3].map((index) => ({ pixels: Array(w * h).fill(index), delay: 10 })),
    w,
    h,
  );
  await page
    .getByLabel('Upload animation')
    .setInputFiles({ name: 'layers.gif', mimeType: 'image/gif', buffer: Buffer.from(file) });
  await expect(convertButton(page)).toBeEnabled();
  await importCode(page, 'CRTVD1:000000FF00000000FF');
  await page.getByLabel('Output width').fill('16');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByRole('button', { name: 'Enable layer stack' }).click();
  await page.getByRole('button', { name: 'Show Original' }).click();
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await page.getByRole('button', { name: 'Edit curves' }).click();
  await page.getByLabel('Curve channel').selectOption('green');
  await page.getByLabel('Output level').fill('128');
  await page.getByLabel('Apply selected resolution to original').uncheck();
  await expect(
    page
      .getByRole('group', { name: 'Colours in the preview' })
      .getByRole('img', { name: '#FF8000' }),
  ).toBeVisible();
  await convertButton(page).click();
  const gif = await exportGif(page);
  expect([gif.clip.info.width, gif.clip.info.height]).toEqual([32, 16]);
  expect(gif.frames.map((frame) => frame.slice(0, 4))).toEqual([
    [255, 128, 0, 255],
    [0, 128, 255, 255],
  ]);
});
