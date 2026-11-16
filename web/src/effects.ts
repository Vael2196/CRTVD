import { createAscii } from './ascii';
import type { AsciiOptions } from './ascii';
import { clamp, createBlur, linear, srgb } from './filters';
import { grade } from './curves';
import type { Curves } from './curves';
import { edgePoint, maskPolygon, polygonDistance } from './maskGeometry';
import type { Geometry } from './maskGeometry';
import { NO_SWATCH, slotIndex, swatchSlots } from './selection';
import type { BlurMode, Filter } from './filters';

export { clamp } from './filters';
export type ColourScope = 'all' | 'except' | 'only';
export type BlendMode = 'off' | 'hard' | 'feather' | 'pyramid';
export interface Effects extends Geometry {
  blend: BlendMode;
  feather: number;
  flip: boolean;
  aberration: number;
  purple: number;
  blur: BlurMode;
  blurRadius: number;
  blurRange: number;
  colourScope: ColourScope;
  effectColours: number[];
  ascii?: AsciiOptions;
  curves?: Curves;
}

export const DEFAULT_EFFECTS: Effects = {
  blend: 'off',
  a: 0.125,
  b: 0.625,
  shape: 'line',
  centre: [0.5, 0.5],
  span: [0.55, 0.55],
  angle: 0,
  bow: [0.82, 0.5],
  stroke: [],
  feather: 0.12,
  flip: false,
  aberration: 0,
  purple: 0,
  blur: 'off',
  blurRadius: 2,
  blurRange: 0.3,
  colourScope: 'all',
  effectColours: [],
};

export const effectEnabled = (e?: Effects): e is Effects =>
  !!e &&
  (e.blend !== 'off' ||
    e.aberration > 0 ||
    e.purple > 0 ||
    e.blur !== 'off' ||
    !!e.ascii ||
    !!e.curves);
export const wrap = (value: number) => ((value % 1) + 1) % 1;

export { edgePoint, nearestEdge } from './maskGeometry';

export function separateEndpoint(position: number, other: number) {
  const delta = wrap(position - other + 0.5) - 0.5;
  return wrap(other + (Math.abs(delta) >= 0.008 ? delta : delta < 0 ? -0.008 : 0.008));
}

function blendMask(w: number, h: number, e: Effects, transition?: number) {
  const [ax, ay] = edgePoint(e.a),
    [bx, by] = edgePoint(e.b);
  const dx = (bx - ax) * w,
    dy = (by - ay) * h;
  const scale = (e.flip ? -1 : 1) / (Math.hypot(dx, dy) || 1);
  const band = transition ?? Math.max(1, Math.min(w, h) * e.feather);
  const useDistance = transition !== undefined || e.blend === 'feather';
  const points = e.shape === 'line' ? [] : maskPolygon(e, w, h);
  const signed = points.length >= 3 ? polygonDistance(points, w, h, useDistance) : undefined;
  const mask = new Float32Array(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    const row = (dx * (y + 0.5 - ay * h) + dy * (ax * w - 0.5)) * scale;
    for (let x = 0; x < w; x++, i++) {
      const d = signed ? signed(x + 0.5, y + 0.5) * (e.flip ? -1 : 1) : row - x * dy * scale;
      if (transition === undefined && e.blend !== 'feather') mask[i] = d >= 0 ? 1 : 0;
      else {
        const t = clamp(0.5 + d / band);
        mask[i] = t * t * (3 - 2 * t);
      }
    }
  }
  return mask;
}

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
    for (let c = 0; c < 3; c++) out[i + c] = srgb(data[i + c] * gain);
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
  private transition?: Float32Array;
  private blur?: Filter;
  private ascii?: Filter;
  private grading?: Filter;
  constructor(
    private w: number,
    private h: number,
    private e: Effects,
  ) {
    if (e.curves) this.grading = grade(e.curves);
    this.blur = createBlur(w, h, e.blur, e.blurRadius, e.blurRange);
    if (e.ascii) this.ascii = createAscii(w, h, e.ascii);
    if (e.blend === 'off' || (e.shape === 'freehand' && e.stroke.length < 3)) return;
    this.masks.push({ data: blendMask(w, h, e), w, h });
    if (e.blend === 'pyramid') {
      // Limit the multiscale transition so neither layer changes far across the seam.
      this.transition = blendMask(w, h, e, Math.min(40, Math.max(1, Math.min(w, h) * 0.85)));
      for (let depth = 0; depth < 4; depth++) {
        const level = this.masks[this.masks.length - 1];
        if (Math.min(level.w, level.h) < 4) break;
        this.masks.push(gaussianDown(level, 1));
      }
    }
  }
  /** The picker ignores areas displaying only the original layer. */
  hideSourceSlots(slots: Uint16Array) {
    const source = this.transition ?? this.masks[0]?.data;
    if (source) for (let p = 0; p < slots.length; p++) if (source[p] === 1) slots[p] = NO_SWATCH;
  }
  apply(
    source: Pixels,
    iw: number,
    ih: number,
    converted: Uint8Array<ArrayBuffer>,
    original = converted,
    palette: ArrayLike<number> = [],
    indices?: Uint16Array,
  ) {
    const { w, h, e, masks } = this;
    let edited = converted;
    if (this.grading || this.blur || e.aberration || e.purple || this.ascii) {
      let allowed: Uint8Array | undefined;
      let active = w * h;
      if (e.colourScope !== 'all' && (e.colourScope === 'only' || e.effectColours.length)) {
        const chosen = swatchSlots(e.effectColours, palette.length / 3);
        const slots = indices ?? slotIndex(original, palette);
        allowed = new Uint8Array(w * h);
        active = 0;
        for (let p = 0; p < slots.length; p++) {
          if (slots[p] !== NO_SWATCH && chosen.has(slots[p]) === (e.colourScope === 'only')) {
            allowed[p] = 1;
            active++;
          }
        }
      }
      const protect = (frame: Uint8Array<ArrayBuffer>) => {
        if (allowed && active < allowed.length)
          for (let p = 0, i = 0; p < allowed.length; p++, i += 4)
            if (!allowed[p]) for (let c = 0; c < 4; c++) frame[i + c] = converted[i + c];
        return frame;
      };
      if (active) {
        if (this.grading) edited = protect(this.grading(edited));
        // Keep protected pixels unchanged even as inputs to subsequent filters.
        if (this.blur) edited = protect(this.blur(edited));
        if (e.aberration || e.purple) edited = protect(fringe(edited, w, h, e));
        if (this.ascii) edited = protect(this.ascii(edited));
      }
    }
    if (!masks.length) return edited;
    const a = sampleSource(source, iw, ih, w, h);
    if (e.blend === 'hard') {
      const out = iw === w && ih === h ? Uint8Array.from(source) : toBytes(a);
      const mask = masks[0].data;
      for (let p = 0, i = 0; p < mask.length; p++, i += 4)
        if (!mask[p]) for (let c = 0; c < 4; c++) out[i + c] = edited[i + c];
      return out;
    }
    const b = premultiplied(edited, w, h);
    const blended = e.blend === 'pyramid' ? pyramid(a, b, masks) : mix(a, b, masks[0].data);
    if (this.transition) {
      for (let p = 0, i = 0; p < this.transition.length; p++, i += 4) {
        const weight = this.transition[p];
        const original = weight >= 0.5;
        const amount = original ? 2 * (1 - weight) : 2 * weight;
        if (amount >= 1) continue;
        const layer = original ? a : b;
        for (let c = 0; c < 4; c++)
          blended.data[i + c] = amount * blended.data[i + c] + (1 - amount) * layer.data[i + c];
      }
    }
    return toBytes(blended);
  }
}
