import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled({ timeout: 30_000 });
}

async function uploadFixture(page: Page, width = 64, height = 32) {
  const fixture = await page.evaluate(
    ({ width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ed593f';
      ctx.fillRect(0, 0, Math.ceil(width / 2), height);
      ctx.fillStyle = '#305cdb';
      ctx.fillRect(Math.ceil(width / 2), 0, width, height);
      ctx.clearRect(0, 0, Math.max(1, Math.floor(width / 8)), Math.max(1, Math.floor(height / 8)));
      return c.toDataURL('image/png').split(',')[1];
    },
    { width, height },
  );
  await page
    .getByLabel('Upload image')
    .setInputFiles({
      name: 'fixture.png',
      mimeType: 'image/png',
      buffer: Buffer.from(fixture, 'base64'),
    });
  await expect(page.getByText('fixture.png', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
}

test('sample renders through the real worker and Wasm without off-site requests', async ({
  page,
}) => {
  const errors: string[] = [];
  const outside: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) outside.push(r.url());
  });
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A little less detail.');
  const canvas = page.getByLabel('Converted image preview');
  await expect(canvas).toHaveAttribute('width', '160');
  await expect(canvas).toHaveAttribute('height', '107');
  const unique = await canvas.evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set();
    for (let i = 0; i < data.length; i += 4)
      colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colours.size;
  });
  expect(unique).toBeGreaterThan(2);
  expect(unique).toBeLessThanOrEqual(16);
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('palette, dither and rapid resolution changes produce the latest result', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Paper & ink' }).click();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await expect(page.locator('.swatches > span')).toHaveCount(2);
  await page.getByLabel('Dithering', { exact: true }).selectOption('none');
  await expect(page.getByLabel('Dither strength')).toBeDisabled();
  await page.getByRole('button', { name: '80px', exact: true }).click();
  await page.getByRole('button', { name: '320px', exact: true }).click();
  await page.getByRole('button', { name: '160px', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await expect(page.getByLabel('Converted image preview')).toHaveAttribute('width', '160');
  await page.getByRole('button', { name: 'Converted', exact: true }).click();
  await expect(page.getByLabel('Original image preview')).toBeHidden();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByLabel('Converted image preview')).toBeHidden();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Dithering', { exact: true })).toHaveValue('bayer');
});

test('upload and PNG export preserve dimensions, alpha and integer pixel scaling', async ({
  page,
}) => {
  await ready(page);
  await uploadFixture(page);
  await expect(page.getByLabel('Converted image preview')).toHaveAttribute('width', '64');
  await page.getByLabel('Export scale').selectOption('2');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fixture-crtvd-128x64.png');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const result = await page.evaluate(async (base64) => {
    const blob = await fetch(`data:image/png;base64,${base64}`).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const p = ctx.getImageData(0, 0, c.width, c.height).data;
    let exact = true;
    for (let y = 0; y < c.height; y += 2)
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        for (const off of [4, c.width * 4, c.width * 4 + 4])
          for (let channel = 0; channel < 4; channel++)
            if (p[i + channel] !== p[i + off + channel]) exact = false;
      }
    return { width: c.width, height: c.height, alpha: p[3], exact };
  }, bytes.toString('base64'));
  expect(result).toEqual({ width: 128, height: 64, alpha: 0, exact: true });
});

test('unsupported files show a useful error and the current image stays usable', async ({
  page,
}) => {
  await ready(page);
  await page
    .getByLabel('Upload image')
    .setInputFiles({ name: 'test.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByRole('alert')).toContainText('still image');
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await page.getByRole('button', { name: 'Try the built-in landscape' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('portrait and tiny images stay within output bounds', async ({ page }) => {
  await ready(page);
  await uploadFixture(page, 1, 128);
  await expect(page.getByLabel('Converted image preview')).toHaveAttribute('width', '1');
  await expect(page.getByLabel('Converted image preview')).toHaveAttribute('height', '128');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
