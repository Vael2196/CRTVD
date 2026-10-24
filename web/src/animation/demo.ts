import { createGifEncoder } from './gif-encoder';

export function makeDemoGif(frameCount = 12) {
  const width = 240,
    height = 160;
  const palette = [
    [13, 25, 34],
    [39, 55, 75],
    [66, 71, 99],
    [131, 91, 119],
    [213, 138, 137],
    [250, 202, 151],
    [255, 227, 175],
    [55, 89, 85],
  ];
  const gif = createGifEncoder();
  for (let frame = 0; frame < frameCount; frame++) {
    const pixels = new Uint8Array(width * height);
    const sunX = 150 + Math.round(Math.sin((frame / 12) * Math.PI * 2) * 28);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let colour = Math.min(5, 2 + Math.floor(y / 38));
        if ((x - sunX) ** 2 + (y - 48) ** 2 < 24 ** 2) colour = 6;
        if (y > 90 - Math.abs(x - 55) * 0.65) colour = 2;
        if (y > 120 - Math.abs(x - 170) * 0.42) colour = 1;
        if (y > 124) colour = 7;
        if (y > 130 && Math.abs(x - sunX) < ((y + frame * 3) % 9) + 8 && y % 7 < 2) colour = 5;
        pixels[y * width + x] = colour;
      }
    gif.writeFrame(pixels, width, height, {
      ...(frame === 0 ? { palette } : {}),
      delay: 100,
      repeat: 0,
      dispose: 1,
    });
  }
  gif.finish();
  return gif.bytes();
}
