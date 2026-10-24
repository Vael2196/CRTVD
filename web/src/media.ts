import type { SourceImage } from './types';
import { snapshotFile, throwIfCancelled } from './uploads';

function imageCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  name: string,
): SourceImage {
  if (width > 16384 || height > 16384 || width * height > 16777216)
    throw new Error(
      'This image is too large. Use at most 16,777,216 pixels and 16,384 pixels per side.',
    );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Your browser could not create an image canvas.');
  context.drawImage(image, 0, 0);
  return { name, width, height, canvas };
}

export async function decodeImage(file: File, signal?: AbortSignal): Promise<SourceImage> {
  const owned = await snapshotFile(file, 'image', signal);
  let bitmap: ImageBitmap | undefined;
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(owned);
  } catch {
    // Some mobile decoders reject a bitmap even when the regular <img> path
    // can decode the same bytes. Fall back without changing file formats.
  }
  if (bitmap) {
    try {
      throwIfCancelled(signal);
      return imageCanvas(bitmap, bitmap.width, bitmap.height, file.name);
    } finally {
      bitmap.close();
    }
  }
  throwIfCancelled(signal);
  const image = new Image();
  const url = URL.createObjectURL(owned);
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = image.onerror = null;
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(
          new Error(
            'This browser could not decode the image. Try saving it as JPEG or PNG first; HEIC/HEIF photos need conversion.',
          ),
        );
      };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    throwIfCancelled(signal);
    return imageCanvas(image, image.naturalWidth, image.naturalHeight, file.name);
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}

export function demoImage(): SourceImage {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 640);
  sky.addColorStop(0, '#302d60');
  sky.addColorStop(0.47, '#cb788b');
  sky.addColorStop(1, '#e6b286');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 960, 640);
  const glow = ctx.createRadialGradient(665, 220, 5, 665, 220, 230);
  glow.addColorStop(0, '#ffe5b6');
  glow.addColorStop(0.48, '#f8c99a');
  glow.addColorStop(1, '#f8c99a00');
  ctx.fillStyle = glow;
  ctx.fillRect(400, 0, 560, 450);
  ctx.fillStyle = '#ffe2a2';
  ctx.beginPath();
  ctx.arc(665, 220, 81, 0, Math.PI * 2);
  ctx.fill();
  const mountain = (points: number[][], colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, 640);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(960, 640);
    ctx.fill();
  };
  mountain(
    [
      [0, 380],
      [180, 200],
      [340, 365],
      [485, 255],
      [690, 400],
      [840, 270],
      [960, 335],
    ],
    '#5a4b73',
  );
  mountain(
    [
      [0, 438],
      [130, 334],
      [300, 460],
      [455, 330],
      [610, 440],
      [810, 355],
      [960, 448],
    ],
    '#354b60',
  );
  const lake = ctx.createLinearGradient(0, 420, 0, 640);
  lake.addColorStop(0, '#9c9ca3');
  lake.addColorStop(1, '#294653');
  ctx.fillStyle = lake;
  ctx.fillRect(0, 450, 960, 190);
  for (let i = 0; i < 32; i++) {
    const y = 460 + i * 5;
    const w = 30 + i * 5;
    ctx.fillStyle = `rgba(255,210,157,${0.4 - i * 0.008})`;
    ctx.fillRect(665 - w / 2 + Math.sin(i * 2) * 12, y, w, 2);
  }
  mountain(
    [
      [0, 545],
      [160, 524],
      [310, 583],
      [490, 596],
      [670, 622],
      [960, 590],
    ],
    '#193c3f',
  );
  const tree = (x: number, y: number, h: number) => {
    ctx.fillStyle = '#152b32';
    ctx.fillRect(x - 3, y - h, 6, h);
    for (let j = 0; j < 4; j++) {
      const top = y - h + j * h * 0.17;
      const half = h * (0.17 + j * 0.035);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - half, top + h * 0.42);
      ctx.lineTo(x + half, top + h * 0.42);
      ctx.fill();
    }
  };
  [
    [65, 565, 260],
    [156, 552, 190],
    [255, 600, 280],
    [850, 625, 250],
    [925, 610, 320],
  ].forEach(([x, y, h]) => tree(x, y, h));
  return { name: 'Dusk at the lake · built-in sample', width: 960, height: 640, canvas };
}

export function maxOutputWidth(source: SourceImage) {
  let width = Math.max(
    1,
    Math.min(1024, source.width, Math.floor(Math.sqrt((1048576 * source.width) / source.height))),
  );
  while (width * Math.max(1, Math.round((width * source.height) / source.width)) > 1048576) width--;
  return Math.max(1, width);
}

export function outputSize(source: SourceImage, targetWidth: number) {
  const width = Math.min(maxOutputWidth(source), Math.max(1, Math.round(targetWidth)));
  const height = Math.max(
    1,
    Math.min(source.height, Math.round((width * source.height) / source.width)),
  );
  return { width, height };
}

export async function downloadPng(canvas: HTMLCanvasElement, filename: string, scale: number) {
  const output = document.createElement('canvas');
  output.width = canvas.width * scale;
  output.height = canvas.height * scale;
  const ctx = output.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, output.width, output.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    output.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png'),
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
