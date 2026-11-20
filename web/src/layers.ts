import { DEFAULT_EFFECTS, EffectRenderer, effectEnabled, sourcePixels } from './effects';
import type { Effects } from './effects';
import { linear, srgb } from './filters';
import type { Geometry } from './maskGeometry';
import { NO_SWATCH, slotIndex } from './selection';
import type { Settings } from './types';

export type LayerMask = Geometry & { id: number; flip: boolean; feather: number };
export type Layer = {
  id: number;
  kind: 'original' | 'conversion' | 'adjustment';
  visible: boolean;
  opacity: number;
  masks: LayerMask[];
  adjustment?: Effects;
};
export const MAX_LAYERS = 8;
export const MAX_MASKS = 8;
export const MAX_DETAIL_PIXELS = 1920 * 1080;

export const newMask = (id: number, geometry = DEFAULT_EFFECTS): LayerMask => {
  const { a, b, shape, centre, span, angle, bow, stroke, flip, feather } = geometry;
  return { id, a, b, shape, centre, span, angle, bow, stroke, flip, feather };
};

export function initialLayers(effects = DEFAULT_EFFECTS): Layer[] {
  return [
    { id: 1, kind: 'conversion', visible: true, opacity: 1, masks: [] },
    {
      id: 2,
      kind: 'original',
      visible: effects.blend !== 'off',
      opacity: 1,
      masks:
        effects.blend !== 'off'
          ? [
              newMask(1, {
                ...effects,
                feather: effects.blend === 'hard' ? 0 : effects.feather,
              }),
            ]
          : [],
    },
  ];
}

export function renderSize(
  iw: number,
  ih: number,
  width: number,
  height: number,
  settings: Settings,
) {
  const hasOriginal = settings.layers
    ? settings.layers.some(
        ({ kind, visible, opacity }) => kind === 'original' && visible && opacity > 0,
      )
    : settings.effects?.blend !== undefined && settings.effects.blend !== 'off';
  if (!hasOriginal || !settings.keepSourceDetail) return { width, height };
  const scale = Math.min(1, Math.sqrt(MAX_DETAIL_PIXELS / (iw * ih)));
  return {
    width: Math.max(1, Math.floor(iw * scale)),
    height: Math.max(1, Math.floor(ih * scale)),
  };
}

function lookups(w: number, h: number, nw: number, nh: number) {
  return {
    xs: Uint32Array.from({ length: nw }, (_, x) =>
      Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw)),
    ),
    ys: Uint32Array.from(
      { length: nh },
      (_, y) => Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh)) * w,
    ),
  };
}
function upscale(
  frame: Uint8Array<ArrayBuffer>,
  { xs, ys }: ReturnType<typeof lookups>,
  w: number,
  h: number,
) {
  if (xs.length === w && ys.length === h) return frame;
  const out = new Uint8Array(xs.length * ys.length * 4);
  for (let y = 0, i = 0; y < ys.length; y++)
    for (let x = 0; x < xs.length; x++, i += 4) {
      const p = (ys[y] + xs[x]) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = frame[p + c];
    }
  return out;
}

export interface PreviewColours {
  original: number[];
  converted: number[];
  mixed: number[];
}
function sampledColours(
  pixels: Uint8Array,
  weights: Uint8Array | undefined,
  w: number,
  h: number,
): PreviewColours {
  const groups = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 16000)));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const p = y * w + x,
        i = p * 4;
      if (!pixels[i + 3]) continue;
      const k = weights?.[p] ?? 0;
      const group = groups[k >= 252 ? 0 : k <= 3 ? 1 : 2];
      const rgb = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      group.set(rgb, (group.get(rgb) ?? 0) + 1);
    }
  const [original, converted, mixed] = groups.map((group) =>
    [...group]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 32)
      .flatMap(([v]) => [v >> 16, (v >> 8) & 255, v & 255]),
  );
  return { original, converted, mixed };
}

export class FrameComposer {
  private readonly primary?: EffectRenderer;
  private readonly legacyBlend?: EffectRenderer;
  private readonly stack: { layer: Layer; coverage?: Float32Array; renderer?: EffectRenderer }[] =
    [];
  private readonly grid;
  private readonly maskGrid;
  readonly width: number;
  readonly height: number;
  constructor(
    private iw: number,
    private ih: number,
    private w: number,
    private h: number,
    private settings: Settings,
  ) {
    const size = renderSize(iw, ih, w, h, settings);
    this.width = size.width;
    this.height = size.height;
    this.grid = lookups(w, h, this.width, this.height);
    const factor = Math.min(1, 512 / Math.max(this.width, this.height));
    const mw = Math.max(1, Math.round(this.width * factor)),
      mh = Math.max(1, Math.round(this.height * factor));
    this.maskGrid = lookups(mw, mh, this.width, this.height);
    const e = settings.effects;
    if (effectEnabled(e)) this.primary = new EffectRenderer(w, h, { ...e, blend: 'off' });
    if (!settings.layers && e && e.blend !== 'off') {
      // A native-sized composite still uses the low-resolution converted layer.
      this.legacyBlend = new EffectRenderer(this.width, this.height, {
        ...DEFAULT_EFFECTS,
        ...newMask(0, e),
        blend: e.blend,
      });
    }
    for (const layer of settings.layers ?? []) {
      if (!layer.visible || layer.opacity <= 0) continue;
      let coverage: Float32Array | undefined;
      for (const mask of layer.masks) {
        coverage ??= new Float32Array(mw * mh);
        const weight = new EffectRenderer(mw, mh, {
          ...DEFAULT_EFFECTS,
          ...mask,
          blend: mask.feather ? 'feather' : 'hard',
        }).sourceWeights();
        if (weight)
          for (let p = 0; p < weight.length; p++) coverage[p] = Math.max(coverage[p], weight[p]);
      }
      const renderer =
        layer.kind === 'adjustment' && effectEnabled(layer.adjustment)
          ? new EffectRenderer(this.width, this.height, { ...layer.adjustment, blend: 'off' })
          : undefined;
      this.stack.push({ layer, coverage, renderer });
    }
  }

  render(
    source: Uint8Array | Uint8ClampedArray,
    converted: Uint8Array<ArrayBuffer>,
    raw: Uint8Array<ArrayBuffer>,
    palette: ArrayLike<number>,
    inspect: boolean,
  ) {
    const { w, h, width, height, grid, maskGrid, iw, ih } = this;
    const indices =
      inspect ||
      this.settings.layers?.some((l) => l.adjustment?.colourScope !== 'all' && l.adjustment)
        ? slotIndex(raw, palette)
        : undefined;
    const edited =
      this.primary?.apply(source, iw, ih, converted, raw, palette, indices) ?? converted;
    const full = upscale(edited, grid, w, h);
    let rgba = full;
    let provenance: Uint8Array | undefined;
    let slots: Uint16Array<ArrayBuffer> | undefined;
    if (indices && (inspect || this.settings.layers)) {
      slots = new Uint16Array(width * height);
      for (let y = 0, p = 0; y < height; y++)
        for (let x = 0; x < width; x++, p++) slots[p] = indices[grid.ys[y] + grid.xs[x]];
    }
    if (this.settings.layers) {
      rgba = new Uint8Array(width * height * 4);
      if (inspect) provenance = new Uint8Array(width * height);
      const original = this.stack.some(({ layer }) => layer.kind === 'original')
        ? sourcePixels(source, iw, ih, width, height)
        : undefined;
      const workingSlots = slots?.slice();
      slots?.fill(NO_SWATCH);
      for (const { layer, coverage, renderer } of this.stack) {
        const adjustment = layer.kind === 'adjustment';
        if (adjustment && !renderer) continue;
        const top = adjustment
          ? renderer!.apply(source, iw, ih, rgba, rgba, palette, slots)
          : layer.kind === 'original'
            ? original!
            : full;
        for (let y = 0, p = 0, i = 0; y < height; y++)
          for (let x = 0; x < width; x++, p++, i += 4) {
            const m = layer.opacity * (coverage?.[maskGrid.ys[y] + maskGrid.xs[x]] ?? 1);
            if (!m) continue;
            if (adjustment) {
              if (!rgba[i + 3]) continue;
              let changed = false;
              for (let c = 0; c < 3; c++) {
                const before = rgba[i + c];
                if (before === top[i + c]) continue;
                const next =
                  m === 1 ? top[i + c] : srgb(linear[top[i + c]] * m + linear[before] * (1 - m));
                rgba[i + c] = next;
                changed ||= before !== next;
              }
              if (changed && provenance) provenance[p] = Math.round(provenance[p] * (1 - m));
              continue;
            }
            const a = (top[i + 3] / 255) * m;
            if (!a) continue;
            const b = (rgba[i + 3] / 255) * (1 - a),
              total = a + b;
            if (b === 0) for (let c = 0; c < 3; c++) rgba[i + c] = top[i + c];
            else
              for (let c = 0; c < 3; c++)
                rgba[i + c] = srgb((linear[top[i + c]] * a + linear[rgba[i + c]] * b) / total);
            rgba[i + 3] = Math.round(total * 255);
            if (provenance)
              provenance[p] = Math.round(
                (a * (layer.kind === 'original' ? 255 : 0) + b * provenance[p]) / total,
              );
            if (slots && (layer.kind === 'conversion' ? a >= b || slots[p] === NO_SWATCH : a === 1))
              slots[p] = layer.kind === 'conversion' ? workingSlots![p] : NO_SWATCH;
          }
      }
    } else if (this.legacyBlend) {
      rgba = this.legacyBlend.apply(source, iw, ih, full);
      const weights = this.legacyBlend.sourceWeights();
      if (inspect && weights) provenance = Uint8Array.from(weights, (v) => Math.round(v * 255));
      if (slots) this.legacyBlend.hideSourceSlots(slots);
    }
    return {
      rgba,
      slots: inspect ? slots : undefined,
      visibleColours: inspect ? sampledColours(rgba, provenance, width, height) : undefined,
    };
  }
}

export function setLayerEffects(settings: Settings, effects: Effects, selected?: Layer): Settings {
  if (selected?.kind !== 'adjustment') return { ...settings, effects };
  return {
    ...settings,
    layers: settings.layers?.map((l) => (l.id === selected.id ? { ...l, adjustment: effects } : l)),
  };
}
