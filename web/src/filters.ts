export type BlurMode = 'off' | 'gaussian' | 'median' | 'bilateral';
export const BLUR_LIMIT: Record<BlurMode, number> = {
  off: 0,
  gaussian: 12,
  median: 3,
  bilateral: 4,
};

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const linear = Float32Array.from({ length: 256 }, (_, x) =>
  x <= 10 ? x / 3294.6 : ((x / 255 + 0.055) / 1.055) ** 2.4,
);
const gamma = Uint8Array.from({ length: 4097 }, (_, x) => {
  const v = x / 4096;
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
});
export const srgb = (v: number) => gamma[Math.round(clamp(v) * 4096)];
export const rgbKey = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

type Frame = Uint8Array<ArrayBuffer>;
export type Filter = (pixels: Frame) => Frame;

const gaussianWeight = (distanceSquared: number, sigma: number) =>
  Math.exp(-distanceSquared / (2 * sigma * sigma));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function gaussian(w: number, h: number, radius: number): Filter {
  const kernel = Float32Array.from({ length: radius * 2 + 1 }, (_, n) =>
    gaussianWeight((n - radius) ** 2, Math.max(0.5, radius / 2)),
  );
  return (input) => {
    const row = new Float32Array(input.length);
    const out = input.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        let r = 0,
          g = 0,
          b = 0,
          alpha = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const q = (y * w + clamp(x + dx, 0, w - 1)) * 4;
          const weight = kernel[dx + radius] * (input[q + 3] / 255);
          r += linear[input[q]] * weight;
          g += linear[input[q + 1]] * weight;
          b += linear[input[q + 2]] * weight;
          alpha += weight;
        }
        row[p] = r;
        row[p + 1] = g;
        row[p + 2] = b;
        row[p + 3] = alpha;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (!input[p + 3]) continue;
        let r = 0,
          g = 0,
          b = 0,
          alpha = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const q = (clamp(y + dy, 0, h - 1) * w + x) * 4;
          const weight = kernel[dy + radius];
          r += row[q] * weight;
          g += row[q + 1] * weight;
          b += row[q + 2] * weight;
          alpha += row[q + 3] * weight;
        }
        out[p] = srgb(r / alpha);
        out[p + 1] = srgb(g / alpha);
        out[p + 2] = srgb(b / alpha);
      }
    return out;
  };
}

function median(w: number, h: number, radius: number): Filter {
  return (input) => {
    const out = input.slice();
    const brightness = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < brightness.length; p++, i += 4)
      brightness[p] = Math.round(luma(input[i], input[i + 1], input[i + 2]));
    const weights = new Uint16Array(256);
    const samples = new Int32Array(256);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (!input[p + 3]) continue;
        let total = 0,
          low = 255,
          high = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const row = clamp(y + dy, 0, h - 1) * w;
          for (let dx = -radius; dx <= radius; dx++) {
            const q = row + clamp(x + dx, 0, w - 1);
            const alpha = input[q * 4 + 3];
            if (!alpha) continue;
            const value = brightness[q];
            low = Math.min(low, value);
            high = Math.max(high, value);
            if (!weights[value]) samples[value] = q * 4;
            weights[value] += alpha;
            total += alpha;
          }
        }
        let value = low,
          cumulative = weights[value];
        while (cumulative * 2 < total && value < high) cumulative += weights[++value];
        const q = brightness[p / 4] === value ? p : samples[value];
        out[p] = input[q];
        out[p + 1] = input[q + 1];
        out[p + 2] = input[q + 2];
        weights.fill(0, low, high + 1);
      }
    return out;
  };
}

function bilateral(w: number, h: number, radius: number, range: number): Filter {
  const taps: { dx: number; dy: number; weight: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++)
      taps.push({ dx, dy, weight: gaussianWeight(dx * dx + dy * dy, Math.max(0.5, radius / 2)) });
  const sigma = 0.05 + clamp(range) * 0.4;
  const colours = Float32Array.from({ length: 1025 }, (_, n) => gaussianWeight(n / 1024, sigma));
  return (input) => {
    const out = input.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (!input[p + 3]) continue;
        let r = 0,
          g = 0,
          b = 0,
          total = 0;
        for (const { dx, dy, weight } of taps) {
          const q = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4;
          if (!input[q + 3]) continue;
          const dr = input[p] - input[q];
          const dg = input[p + 1] - input[q + 1];
          const db = input[p + 2] - input[q + 2];
          const delta = Math.round((1024 * (dr * dr + dg * dg + db * db)) / (3 * 255 * 255));
          const k = weight * colours[delta] * (input[q + 3] / 255);
          r += linear[input[q]] * k;
          g += linear[input[q + 1]] * k;
          b += linear[input[q + 2]] * k;
          total += k;
        }
        out[p] = srgb(r / total);
        out[p + 1] = srgb(g / total);
        out[p + 2] = srgb(b / total);
      }
    return out;
  };
}

export function createBlur(w: number, h: number, mode: BlurMode, size: number, range: number) {
  const radius = clamp(Math.round(size), 0, BLUR_LIMIT[mode]);
  if (!radius) return undefined;
  if (mode === 'gaussian') return gaussian(w, h, radius);
  if (mode === 'median') return median(w, h, radius);
  if (mode === 'bilateral') return bilateral(w, h, radius, range);
}
