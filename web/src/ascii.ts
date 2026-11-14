import { asciiFont } from './asciiFont';
import { clamp, linear, srgb } from './filters';
import type { Filter } from './filters';

export const ASCII_RAMPS = {
  classic: ' .:-=+*#%@',
  terminal: ' .01#@',
  sparse: ' .:+=#',
  custom: '',
};
export interface AsciiOptions {
  symbols: keyof typeof ASCII_RAMPS;
  custom: string;
  cell: number;
  size: number;
  contrast: number;
  invert: boolean;
  ink: 'palette' | 'white';
}

export const DEFAULT_ASCII: AsciiOptions = {
  symbols: 'classic',
  custom: ' .:-=+*#%@',
  cell: 10,
  size: 1,
  contrast: 1,
  invert: false,
  ink: 'palette',
};

export function asciiRamp(options: AsciiOptions) {
  const input = options.symbols === 'custom' ? options.custom : ASCII_RAMPS[options.symbols];
  return input.replace(/[^ -~]/g, '').slice(0, 32) || ASCII_RAMPS.classic;
}

/** Rasterise on the processing grid with a bundled bitmap font, so PNG/GIF/video
 * use the same glyphs regardless of platform or fonts installed on the device. */
export function createAscii(w: number, h: number, options: AsciiOptions): Filter {
  const ramp = asciiRamp(options);
  const step = clamp(Math.round(options.cell), 4, 32);
  const size = Math.max(1, Math.round(step * clamp(options.size, 0.35)));
  const inset = Math.floor((step - size) / 2);
  const cellBit = Array.from({ length: size }, (_, n) => Math.floor(((n + 0.5) * 8) / size));
  const glyphs = Array.from(ramp, (c) => (c.charCodeAt(0) - 32) * 8);
  return (input) => {
    const out = input.slice();
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const ex = Math.min(w, x + step),
          ey = Math.min(h, y + step);
        let r = 0,
          g = 0,
          b = 0,
          alpha = 0;
        for (let sy = y; sy < ey; sy++)
          for (let sx = x; sx < ex; sx++) {
            const i = (sy * w + sx) * 4;
            const a = input[i + 3];
            r += a * linear[input[i]];
            g += a * linear[input[i + 1]];
            b += a * linear[input[i + 2]];
            alpha += a;
          }
        if (!alpha) continue;
        const luma = srgb((0.2126 * r + 0.7152 * g + 0.0722 * b) / alpha) / 255;
        const tone = clamp((luma - 0.5) * options.contrast + 0.5);
        const letter = glyphs[Math.round((options.invert ? 1 - tone : tone) * (glyphs.length - 1))];
        for (let sy = y; sy < ey; sy++) {
          const row = cellBit[sy - y - inset];
          const bits = row === undefined ? 0 : asciiFont[letter + row];
          for (let sx = x; sx < ex; sx++) {
            const i = (sy * w + sx) * 4;
            if (!input[i + 3]) continue;
            const bit = cellBit[sx - x - inset];
            const ink = bit !== undefined && !!(bits & (1 << bit));
            // Reuse the converted pixel's RGB in colour mode to preserve the palette.
            for (let c = 0; c < 3; c++)
              out[i + c] = !ink ? 0 : options.ink === 'white' ? 255 : input[i + c];
          }
        }
      }
    return out;
  };
}
