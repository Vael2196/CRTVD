export type BlendMode = 'off' | 'hard' | 'feather' | 'pyramid';
export interface Effects {
  blend: BlendMode;
  a: number;
  b: number;
  feather: number;
  flip: boolean;
  aberration: number;
  purple: number;
}

export const DEFAULT_EFFECTS: Effects = {
  blend: 'off',
  a: 0.125,
  b: 0.625,
  feather: 0.12,
  flip: false,
  aberration: 0,
  purple: 0,
};

export const effectEnabled = (e?: Effects): e is Effects =>
  !!e && (e.blend !== 'off' || e.aberration > 0 || e.purple > 0);

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const wrap = (value: number) => ((value % 1) + 1) % 1;

export function edgePoint(position: number): [number, number] {
  const p = wrap(position) * 4;
  return p < 1 ? [p, 0] : p < 2 ? [1, p - 1] : p < 3 ? [3 - p, 1] : [0, 4 - p];
}

export function nearestEdge(x: number, y: number, width: number, height: number) {
  x = clamp(x);
  y = clamp(y);
  const distances = [y * height, (1 - x) * width, (1 - y) * height, x * width];
  return wrap([x, 1 + y, 3 - x, 4 - y][distances.indexOf(Math.min(...distances))] / 4);
}

export function separateEndpoint(position: number, other: number) {
  const delta = wrap(position - other + 0.5) - 0.5;
  return wrap(other + (Math.abs(delta) >= 0.008 ? delta : delta < 0 ? -0.008 : 0.008));
}

function blendMask(w: number, h: number, e: Effects) {
  const [ax, ay] = edgePoint(e.a),
    [bx, by] = edgePoint(e.b);
  const dx = (bx - ax) * w,
    dy = (by - ay) * h;
  const scale = (e.flip ? -1 : 1) / (Math.hypot(dx, dy) || 1);
  const band = Math.max(1, Math.min(w, h) * e.feather);
  const mask = new Float32Array(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    const row = (dx * (y + 0.5 - ay * h) + dy * (ax * w - 0.5)) * scale;
    for (let x = 0; x < w; x++, i++) {
      const d = row - x * dy * scale;
      if (e.blend !== 'feather') mask[i] = d >= 0 ? 1 : 0;
      else {
        const t = clamp(0.5 + d / band);
        mask[i] = t * t * (3 - 2 * t);
      }
    }
  }
  return mask;
}

const linear = Float32Array.from({ length: 256 }, (_, x) =>
  x <= 10 ? x / 3294.6 : ((x / 255 + 0.055) / 1.055) ** 2.4,
);
const gamma = Uint8Array.from({ length: 4097 }, (_, x) => {
  const v = x / 4096;
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
});

type Pixels = Uint8Array | Uint8ClampedArray;
interface FloatImage {
  data: Float32Array;
  w: number;
  h: number;
}

function premultiplied(data: Pixels, w: number, h: number): FloatImage {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = linear[data[i]] * a;
    out[i + 1] = linear[data[i + 1]] * a;
    out[i + 2] = linear[data[i + 2]] * a;
    out[i + 3] = a;
  }
  return { data: out, w, h };
}

function toBytes({ data }: FloatImage) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < out.length; i += 4) {
    const a = clamp(data[i + 3]);
    out[i + 3] = Math.round(a * 255);
    if (!out[i + 3]) continue;
    const gain = 1 / a;
    for (let c = 0; c < 3; c++) out[i + c] = gamma[Math.round(clamp(data[i + c] * gain) * 4096)];
  }
  return out;
}

/** Resample directly to output size. Never allocate a full-resolution float
 * copy of the source; interpolate in premultiplied linear light. */
function sampleSource(input: Pixels, iw: number, ih: number, w: number, h: number): FloatImage {
  if (iw === w && ih === h) return premultiplied(input, w, h);
  const data = new Float32Array(w * h * 4);
  const xs = Float32Array.from({ length: w }, (_, x) =>
    clamp(((x + 0.5) * iw) / w - 0.5, 0, iw - 1),
  );
  for (let y = 0, i = 0; y < h; y++) {
    const sy = clamp(((y + 0.5) * ih) / h - 0.5, 0, ih - 1);
    const y0 = Math.floor(sy),
      y1 = Math.min(ih - 1, y0 + 1),
      ty = sy - y0;
    for (let x = 0; x < w; x++, i += 4) {
      const x0 = Math.floor(xs[x]),
        x1 = Math.min(iw - 1, x0 + 1),
        tx = xs[x] - x0;
      const p = (y0 * iw + x0) * 4,
        q = (y0 * iw + x1) * 4;
      const r = (y1 * iw + x0) * 4,
        s = (y1 * iw + x1) * 4;
      const ap = (input[p + 3] / 255) * (1 - tx) * (1 - ty);
      const aq = (input[q + 3] / 255) * tx * (1 - ty);
      const ar = (input[r + 3] / 255) * (1 - tx) * ty;
      const as = (input[s + 3] / 255) * tx * ty;
      data[i + 3] = ap + aq + ar + as;
      for (let c = 0; c < 3; c++)
        data[i + c] =
          linear[input[p + c]] * ap +
          linear[input[q + c]] * aq +
          linear[input[r + c]] * ar +
          linear[input[s + c]] * as;
    }
  }
  return { data, w, h };
}

const weights = [1, 4, 6, 4, 1];
function gaussianDown({ data, w, h }: FloatImage, channels: number): FloatImage {
  const nw = Math.ceil(w / 2),
    nh = Math.ceil(h / 2);
  const temp = new Float32Array(nw * h * channels),
    out = new Float32Array(nw * nh * channels);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < nw; x++) {
      const at = (y * nw + x) * channels;
      for (let k = 0; k < 5; k++) {
        const from = (y * w + clamp(2 * x + k - 2, 0, w - 1)) * channels;
        const weight = weights[k] / 16;
        for (let c = 0; c < channels; c++) temp[at + c] += data[from + c] * weight;
      }
    }
  for (let y = 0; y < nh; y++)
    for (let k = 0; k < 5; k++) {
      const from = clamp(2 * y + k - 2, 0, h - 1) * nw * channels;
      const at = y * nw * channels,
        weight = weights[k] / 16;
      for (let j = 0; j < nw * channels; j++) out[at + j] += temp[from + j] * weight;
    }
  return { data: out, w: nw, h: nh };
}

function expand({ data, w, h }: FloatImage, nw: number, nh: number) {
  const out = new Float32Array(nw * nh * 4);
  for (let y = 0, i = 0; y < nh; y++) {
    const y0 = y >> 1,
      y1 = Math.min(h - 1, y0 + (y & 1));
    for (let x = 0; x < nw; x++, i += 4) {
      const x0 = x >> 1,
        x1 = Math.min(w - 1, x0 + (x & 1));
      const p = (y0 * w + x0) * 4,
        q = (y0 * w + x1) * 4;
      const r = (y1 * w + x0) * 4,
        s = (y1 * w + x1) * 4;
      for (let c = 0; c < 4; c++)
        out[i + c] = (data[p + c] + data[q + c] + data[r + c] + data[s + c]) * 0.25;
    }
  }
  return out;
}

function mix(a: FloatImage, b: FloatImage, mask: Float32Array): FloatImage {
  const data = new Float32Array(a.data.length);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const t = mask[p],
      u = 1 - t;
    for (let c = 0; c < 4; c++) data[i + c] = a.data[i + c] * t + b.data[i + c] * u;
  }
  return { ...a, data };
}

function pyramid(a: FloatImage, b: FloatImage, masks: FloatImage[], level = 0): FloatImage {
  if (level === masks.length - 1) return mix(a, b, masks[level].data);
  const lowA = gaussianDown(a, 4),
    lowB = gaussianDown(b, 4);
  const upA = expand(lowA, a.w, a.h),
    upB = expand(lowB, b.w, b.h);
  const combined = expand(pyramid(lowA, lowB, masks, level + 1), a.w, a.h);
  const mask = masks[level].data;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const t = mask[p],
      u = 1 - t;
    for (let c = 0; c < 4; c++)
      combined[i + c] += (a.data[i + c] - upA[i + c]) * t + (b.data[i + c] - upB[i + c]) * u;
  }
  return { ...a, data: combined };
}

function fringe(input: Uint8Array, w: number, h: number, e: Effects) {
  const out = input.slice();
  const cx = (w - 1) / 2,
    cy = (h - 1) / 2;
  const shift = e.aberration * Math.max(1.5, Math.min(10, Math.min(w, h) * 0.025));
  const at = (x: number, y: number) => (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
  const luma = (i: number) =>
    ((input[i] * 0.213 + input[i + 1] * 0.715 + input[i + 2] * 0.072) * input[i + 3]) / 255;
  function channel(x: number, y: number, c: number, fallback: number) {
    x = clamp(x, 0, w - 1);
    y = clamp(y, 0, h - 1);
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      tx = x - x0,
      ty = y - y0;
    const p = at(x0, y0),
      q = at(x0 + 1, y0),
      r = at(x0, y0 + 1),
      s = at(x0 + 1, y0 + 1);
    const ap = (1 - tx) * (1 - ty) * input[p + 3],
      aq = tx * (1 - ty) * input[q + 3];
    const ar = (1 - tx) * ty * input[r + 3],
      as = tx * ty * input[s + 3],
      alpha = ap + aq + ar + as;
    return alpha
      ? (input[p + c] * ap + input[q + c] * aq + input[r + c] * ar + input[s + c] * as) / alpha
      : fallback;
  }
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i += 4) {
      if (!input[i + 3]) continue;
      let red = input[i],
        green = input[i + 1],
        blue = input[i + 2];
      if (shift) {
        const dx = (shift * (x - cx)) / Math.max(1, cx);
        const dy = (shift * (y - cy)) / Math.max(1, cy);
        red = channel(x + dx, y + dy, 0, red);
        blue = channel(x - dx, y - dy, 2, blue);
      }
      if (e.purple) {
        const centre = luma(i);
        const highlight = Math.max(
          luma(at(x - 1, y)),
          luma(at(x + 1, y)),
          luma(at(x, y - 1)),
          luma(at(x, y + 1)),
        );
        const halo =
          e.purple * 0.72 * clamp((highlight - centre - 20) / 120) * clamp((highlight - 110) / 100);
        red += (184 - red) * halo;
        green += (49 - green) * halo;
        blue += (235 - blue) * halo;
      }
      out[i] = Math.round(red);
      out[i + 1] = Math.round(green);
      out[i + 2] = Math.round(blue);
    }
  return out;
}

/** Masks and their Gaussian levels are shared by all frames of a job. */
export class EffectRenderer {
  private masks: FloatImage[] = [];
  constructor(
    private w: number,
    private h: number,
    private e: Effects,
  ) {
    if (e.blend === 'off') return;
    this.masks.push({ data: blendMask(w, h, e), w, h });
    if (e.blend === 'pyramid') {
      for (let depth = 0; depth < 4; depth++) {
        const level = this.masks[this.masks.length - 1];
        if (Math.min(level.w, level.h) < 4) break;
        this.masks.push(gaussianDown(level, 1));
      }
    }
  }
  apply(source: Pixels, iw: number, ih: number, converted: Uint8Array<ArrayBuffer>) {
    const { w, h, e, masks } = this;
    let out = converted;
    if (masks.length) {
      const a = sampleSource(source, iw, ih, w, h);
      if (e.blend === 'hard') {
        out = toBytes(a);
        const mask = masks[0].data;
        for (let p = 0, i = 0; p < mask.length; p++, i += 4)
          if (!mask[p]) {
            out[i] = converted[i];
            out[i + 1] = converted[i + 1];
            out[i + 2] = converted[i + 2];
            out[i + 3] = converted[i + 3];
          }
      } else {
        const b = premultiplied(converted, w, h);
        out = toBytes(e.blend === 'pyramid' ? pyramid(a, b, masks) : mix(a, b, masks[0].data));
      }
    }
    if (e.aberration || e.purple) out = fringe(out, w, h, e);
    return out;
  }
}
