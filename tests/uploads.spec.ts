import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { makeDemoGif } from '../web/src/animation/demo';

const png = readFileSync('tests/reference/input-scene.png');

type Metrics = { earlyReset: number; originalToWorker: number; ownedToWorker: number };
declare global {
  interface Window {
    uploadMetrics?: Metrics;
  }
}

// Desktop file payloads do not reproduce a phone's transient provider handle.
// Simulate loss of that handle on input reset / worker hand-off, while keeping
// the real FileReader, image decoders, workers, Wasm and encoders in use.
async function providerLease(page: Page) {
  await page.addInitScript(() => {
    const selected = new WeakSet<Blob>();
    const pending = new WeakSet<Blob>();
    const released = new WeakSet<Blob>();
    const metrics = { earlyReset: 0, originalToWorker: 0, ownedToWorker: 0 };
    window.uploadMetrics = metrics;
    document.addEventListener(
      'change',
      (event) => {
        const field = event.target;
        if (field instanceof HTMLInputElement && field.type === 'file')
          for (const file of Array.from(field.files ?? [])) selected.add(file);
      },
      true,
    );
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...value,
      set(next: string) {
        if (this.type === 'file' && next === '') {
          for (const file of Array.from(this.files ?? []) as File[]) {
            if (pending.has(file)) metrics.earlyReset++;
            released.add(file);
          }
        }
        value.set!.call(this, next);
      },
    });
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (file: Blob) {
      if (!selected.has(file)) return read.call(this, file);
      pending.add(file);
      const done = () => pending.delete(file);
      this.addEventListener('load', done, { once: true, capture: true });
      this.addEventListener('loadend', done, { once: true });
      setTimeout(
        () => {
          if (!this.onload) {
            pending.delete(file);
            return;
          }
          if (released.has(file)) {
            this.dispatchEvent(new ProgressEvent('error'));
            pending.delete(file);
          } else read.call(this, file);
        },
        file instanceof File && file.name.startsWith('slow') ? 1200 : 80,
      );
    };
    const bitmap = window.createImageBitmap;
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      const file = args[0];
      if (!(file instanceof File) || !selected.has(file)) return bitmap(...args);
      return new Promise<ImageBitmap>((resolve, reject) =>
        setTimeout(() => {
          if (released.has(file))
            reject(new DOMException('The source image could not be decoded', 'InvalidStateError'));
          else bitmap(...args).then(resolve, reject);
        }, 100),
      );
    }) as typeof createImageBitmap;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      transfer?: Transferable[] | StructuredSerializeOptions,
    ) {
      const file = (message as { file?: File })?.file;
      if (file instanceof File) {
        if (selected.has(file)) {
          metrics.originalToWorker++;
          throw new DOMException(
            'Provider file cannot be read in another process',
            'NotReadableError',
          );
        }
        metrics.ownedToWorker++;
      }
      return post.call(this, message, Array.isArray(transfer) ? { transfer } : transfer);
    };
  });
}

async function ready(page: Page, animation = false) {
  await page.goto('./');
  if (animation) {
    await page.getByRole('button', { name: 'Animation', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Give every frame');
  } else await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
}

test('image picker stays valid until its bytes are owned, and the same file can be selected again', async ({
  page,
}) => {
  await providerLease(page);
  await ready(page);
  const file = { name: 'provider.png', mimeType: 'image/png', buffer: png };
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Upload image').setInputFiles(file);
    await expect(page.getByText('provider.png', { exact: true })).toBeVisible();
    await expect.poll(() => page.getByLabel('Upload image').inputValue()).toBe('');
  }
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.uploadMetrics!.earlyReset)).toBe(0);
});

test('GIF workers use an owned file after the original picker reference is released', async ({
  page,
}) => {
  await providerLease(page);
  await ready(page, true);
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'provider.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(makeDemoGif(3)),
  });
  await expect(page.getByText('provider.gif', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByLabel('Upload animation').inputValue()).toBe('');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download GIF' })).toBeVisible();
  const metrics = await page.evaluate(() => window.uploadMetrics!);
  expect(metrics.earlyReset).toBe(0);
  expect(metrics.originalToWorker).toBe(0);
  expect(metrics.ownedToWorker).toBe(2);
});

for (const mode of ['rejects', 'missing'] as const) {
  test(`regular image decoding handles createImageBitmap ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      Object.defineProperty(window, 'createImageBitmap', {
        configurable: true,
        value:
          mode === 'missing'
            ? undefined
            : () =>
                Promise.reject(
                  new DOMException('The source image could not be decoded', 'InvalidStateError'),
                ),
      });
    }, mode);
    await ready(page);
    await page
      .getByLabel('Upload image')
      .setInputFiles({ name: 'fallback.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('fallback.png', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
    const canvas = page.getByLabel('Converted image preview');
    await expect(canvas).toHaveAttribute('width', '96');
    await expect(canvas).toHaveAttribute('height', '64');
    const alpha = await canvas.evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return Array.from(data).filter((_, index) => index % 4 === 3);
    });
    const expected = Array.from(PNG.sync.read(png).data).filter((_, index) => index % 4 === 3);
    expect(alpha).toEqual(expected);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('generic MIME labels from file providers fall back to the filename', async ({ page }) => {
  await ready(page);
  await page
    .getByLabel('Upload image')
    .setInputFiles({ name: 'phone-photo.PNG', mimeType: 'application/octet-stream', buffer: png });
  await expect(page.getByText('phone-photo.PNG', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
});

test('regular JPEG fallback respects the phone photo EXIF orientation', async ({ page }) => {
  await page.addInitScript(() => {
    window.createImageBitmap = () =>
      Promise.reject(new DOMException('Bitmap decoder unavailable', 'InvalidStateError'));
  });
  // Keep the existing JPEG pixels and insert an EXIF orientation=6 APP1 tag.
  const jpeg = readFileSync('tests/reference/input-photo.jpg');
  const exif = Buffer.from(
    'ffe1002245786966000049492a0008000000010012010300010000000600000000000000',
    'hex',
  );
  await ready(page);
  await page.getByLabel('Upload image').setInputFiles({
    name: 'rotated.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]),
  });
  await expect(page.getByText('rotated.jpg', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Converted image preview')).toHaveAttribute('width', '64');
  await expect(page.getByLabel('Converted image preview')).toHaveAttribute('height', '96');
});

test('a provider video with no filename extension can be probed and converted after input reset', async ({
  page,
}) => {
  await providerLease(page);
  await ready(page, true);
  const fixture = await page.evaluate(async () => {
    if (
      typeof MediaRecorder === 'undefined' ||
      !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    )
      return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    for (const colour of ['#ee4411', '#2233ee', '#22bb66']) {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 64, 32);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    recorder.stop();
    await done;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  test.skip(!fixture, 'This browser has no VP8 recorder.');
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'provider-video',
    mimeType: 'video/webm',
    buffer: Buffer.from(fixture!),
  });
  await expect(page.getByText('provider-video', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByLabel('Upload animation').inputValue()).toBe('');
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download GIF' })).toBeVisible();
  expect(await page.evaluate(() => window.uploadMetrics!.originalToWorker)).toBe(0);
});

test('unreadable provider files show recovery instructions and preserve the current image', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (file: Blob) {
      if (file instanceof File && file.name.startsWith('locked')) {
        setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
      } else read.call(this, file);
    };
  });
  await ready(page);
  await page
    .getByLabel('Upload image')
    .setInputFiles({ name: 'locked.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('alert')).toContainText('Save or download it to this device');
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'locked.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(makeDemoGif(2)),
  });
  await expect(page.getByRole('alert')).toContainText('Save or download it to this device');
  await page.getByRole('button', { name: 'Try the moving landscape' }).click();
  await expect(page.getByRole('button', { name: 'Convert animation', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('cancel a pending provider read and start another animation without a stale probe', async ({
  page,
}) => {
  await providerLease(page);
  await ready(page, true);
  await page.getByLabel('Upload animation').setInputFiles({
    name: 'slow.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(makeDemoGif(2)),
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Try the moving landscape' }).click();
  await expect(page.getByText('moving-dusk.gif', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Convert animation', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download GIF' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('unsupported HEIC photos explain the required conversion', async ({ page }) => {
  await ready(page);
  await page
    .getByLabel('Upload image')
    .setInputFiles({ name: 'camera.heic', mimeType: 'image/heic', buffer: Buffer.from('heic') });
  await expect(page.getByRole('alert')).toContainText('Export or save the photo as JPEG or PNG');
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
});
