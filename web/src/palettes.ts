import type { Settings } from './types';

export type RGB = [number, number, number];
export interface PaletteEdit {
  original: number[];
  colours: number[];
}

export const triplets = (packed: ArrayLike<number>): RGB[] =>
  Array.from({ length: Math.floor(packed.length / 3) }, (_, i) => [
    packed[i * 3],
    packed[i * 3 + 1],
    packed[i * 3 + 2],
  ]);

export const hex = (rgb: RGB) =>
  '#' +
  rgb
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

export function fromHex(input: string): RGB | null {
  const value = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as RGB;
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => n === b[i]);

export function encodePalette(colours: ArrayLike<number>) {
  validatePalette(colours, 256);
  return (
    'CRTVD1:' +
    triplets(uniqueColours(colours))
      .map((rgb) => hex(rgb).slice(1))
      .join('')
  );
}

export function decodePalette(input: string, max = 256) {
  const code = input.trim();
  if (code.length > 7 + 6 * 256 || !/^CRTVD1:(?:[0-9a-f]{6})+$/i.test(code))
    throw new Error('Enter a valid CRTVD1 palette code.');
  const colours = uniqueColours(
    code
      .slice(7)
      .match(/.{6}/g)!
      .flatMap((value) => fromHex(value)!),
  );
  validatePalette(colours, max);
  return colours;
}

function validatePalette(values: ArrayLike<number>, max: number) {
  if (
    !values.length ||
    values.length % 3 ||
    values.length > max * 3 ||
    Array.from(values).some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw new Error(
      `Use 1–${max} RGB colours${max === 255 ? '; GIF reserves one entry for transparency' : ''}.`,
    );
}

export function uniqueColours(values: ArrayLike<number>) {
  const used = new Set<number>();
  return triplets(values)
    .filter(([r, g, b]) => {
      const key = (r << 16) | (g << 8) | b;
      if (used.has(key)) return false;
      used.add(key);
      return true;
    })
    .flat();
}

export function quantisationPalette(settings: Settings, max = 256) {
  const { customPalette, importedPalette, paletteEdit } = settings;
  const original = paletteEdit?.original ?? importedPalette ?? customPalette;
  if (paletteEdit) {
    validatePalette(paletteEdit.colours, max);
    if (paletteEdit.colours.length !== paletteEdit.original.length)
      throw new Error('Palette edits must keep the original swatch slots.');
  }
  if (!original) return undefined;
  validatePalette(original, max);
  return Uint8Array.from(original);
}

export function editSwatch(
  settings: Settings,
  original: number[],
  index: number,
  rgb: RGB,
): Settings {
  const baseline = settings.paletteEdit?.original ?? original;
  const colours = (settings.paletteEdit?.colours ?? baseline).slice();
  colours.splice(index * 3, 3, ...rgb);
  return {
    ...settings,
    paletteEdit: same(baseline, colours) ? undefined : { original: baseline.slice(), colours },
  };
}

/** Simultaneous RGB replacement keeps dither positions and alpha. A swap or
 * two slots with the same new colour do not affect the assignment of pixels. */
export function remapPalette(edit?: PaletteEdit) {
  const lookup = new Map<number, RGB>();
  if (edit)
    triplets(edit.colours).forEach((rgb, i) => {
      const p = i * 3;
      const [r, g, b] = edit.original.slice(p, p + 3);
      if (r !== rgb[0] || g !== rgb[1] || b !== rgb[2]) lookup.set((r << 16) | (g << 8) | b, rgb);
    });
  return (pixels: Uint8Array<ArrayBuffer>) => {
    if (!lookup.size) return pixels;
    const result = pixels.slice();
    for (let i = 0; i < result.length; i += 4) {
      if (!result[i + 3]) continue;
      const rgb = lookup.get((result[i] << 16) | (result[i + 1] << 8) | result[i + 2]);
      if (rgb) result.set(rgb, i);
    }
    return result;
  };
}

export const clearPaletteChanges = (s: Settings): Settings => ({
  ...s,
  importedPalette: undefined,
  paletteEdit: undefined,
});

export function rgbToHsv([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h = !d ? 0 : max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}

export function hsvToRgb([h, s, v]: RGB): RGB {
  const hue = (((h % 360) + 360) % 360) / 60;
  const channel = (n: number) =>
    Math.round(
      255 * v * (1 - s * Math.max(0, Math.min(1, Math.min((n + hue) % 6, 4 - ((n + hue) % 6))))),
    );
  return [channel(5), channel(3), channel(1)];
}

const linear = (byte: number) =>
  byte <= 10 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4;

function lab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.41222147 * r + 0.53633254 * g + 0.05144599 * b);
  const m = Math.cbrt(0.2119035 * r + 0.68069955 * g + 0.10739696 * b);
  const s = Math.cbrt(0.08830246 * r + 0.28171884 * g + 0.6299787 * b);
  return [
    0.21045426 * l + 0.79361779 * m - 0.00407205 * s,
    1.9779985 * l - 2.42859221 * m + 0.45059371 * s,
    0.02590404 * l + 0.78277177 * m - 0.80867577 * s,
  ];
}

const distance = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function suggestColours(selected: RGB, current: RGB[]) {
  const origin = lab(selected);
  const used = new Set(current.map(hex));
  const nearby = current
    .filter((c) => !same(c, selected))
    .map((c) => ({ c, distance: distance(origin, lab(c)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 4)
    .map(({ c }) => c);
  const [h, s, v] = rgbToHsv(selected);
  const brightness = Math.max(0.44, Math.min(0.9, v));
  const saturation = Math.max(0.32, s * 0.82);
  const partner = current
    .filter((c) => !same(c, selected))
    .map(rgbToHsv)
    .sort((a, b) => b[1] - a[1])[0];
  const pairHue = s < 0.1 && partner ? partner[0] : h;
  const paired = [26, -26, 150, 210, 180].map((offset) =>
    hsvToRgb([pairHue + offset, saturation, brightness]),
  );
  const existing = [...current, selected].map(lab);
  const accent = [0, 45, 95, 145, 195, 240, 290, 335]
    .flatMap((angle) =>
      [0.62, 0.92].map((light) => {
        const c = hsvToRgb([angle, 0.76, light]),
          point = lab(c);
        return { c, score: Math.min(...existing.map((p) => distance(p, point))) };
      }),
    )
    .sort((a, b) => b.score - a.score)
    .map(({ c }) => c);
  const take = (colours: RGB[], count: number) =>
    colours
      .filter((rgb) => {
        const key = hex(rgb);
        if (used.has(key)) return false;
        used.add(key);
        return true;
      })
      .slice(0, count);
  return { nearby, paired: take(paired, 4), contrast: take(accent, 3) };
}
