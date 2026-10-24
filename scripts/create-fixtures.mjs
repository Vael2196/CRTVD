import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
// Owned, procedural test artwork: gradients, sharp edges, a checker pattern,
// and alpha ramps. No downloaded photographs or model-generated inputs.
export function scene(width, height) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const nx = Math.floor((x * 96) / width),
        ny = Math.floor((y * 64) / height),
        p = (y * width + x) * 4;
      let r = Math.floor((255 * x) / Math.max(1, width - 1)),
        g = Math.floor((255 * y) / Math.max(1, height - 1)),
        b = (nx * 19 + ny * 11) % 256,
        a = 255;
      if (nx < 25 && ny < 24) {
        r = (nx + ny) % 2 ? 255 : 0;
        g = 40;
        b = 200;
      }
      if ((nx - 65) ** 2 + (ny - 22) ** 2 < 14 ** 2) {
        r = 250;
        g = 190;
        b = 40;
      }
      if (ny > 42 && nx < 45) {
        r = 40;
        g = 210;
        b = 130;
        a = Math.floor((nx / 44) * 255);
      }
      if (nx === ny) {
        r = 255;
        g = 255;
        b = 255;
      }
      png.data.set([r, g, b, a], p);
    }
  return PNG.sync.write(png);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').at(-1))) {
  mkdirSync('tests/reference', { recursive: true });
  mkdirSync('benchmarks/fixtures', { recursive: true });
  writeFileSync('tests/reference/input-scene.png', scene(96, 64));
  writeFileSync('benchmarks/fixtures/scene.png', scene(960, 640));
  console.log('Created owned reference and benchmark PNG inputs.');
}
