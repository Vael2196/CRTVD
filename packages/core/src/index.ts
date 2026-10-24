/** The processing package has no React, DOM, codec or container dependency. */
export const VERSION = '0.3.0';
export type PaletteMode = 'adaptive' | 'monochrome' | 'handheld' | 'cga';
export type Dither = 'none' | 'bayer' | 'floyd';
export type Resample = 'area' | 'nearest';
export interface Frame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}
export interface ProcessOptions {
  /** Output width. Defaults to min(160, input width). */
  width?: number;
  /** If omitted, preserve aspect ratio to the nearest pixel. */
  height?: number;
  palette?: PaletteMode;
  colours?: number;
  dither?: Dither;
  strength?: number;
  resample?: Resample;
  /** Packed sRGB RGB triplets; overrides palette generation when provided. */
  customPalette?: Uint8Array;
}
export interface ProcessedFrame {
  data: Uint8Array<ArrayBuffer>;
  palette: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** Engine call only, excluding JS/Wasm input/output copies. */
  processingMs: number;
  /** Whole synchronous API call, including validation and copies. */
  totalMs: number;
}
export interface CreateOptions {
  /** Bundlers should supply a served public asset URL or an imported ?url. */
  loaderUrl?: string | URL;
  wasmUrl?: string | URL;
  /** Useful in Node and tests, avoiding any fetch of the Wasm binary. */
  wasmBinary?: Uint8Array;
}
interface Module {
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  UTF8ToString(p: number): string;
  _crtvd_last_error(): number;
  _crtvd_process_palette(
    p: number,
    n: number,
    iw: number,
    ih: number,
    ow: number,
    oh: number,
    palette: number,
    colours: number,
    dither: number,
    strength: number,
    resample: number,
    pp: number,
    pn: number,
  ): number;
  _crtvd_result_pixels(r: number): number;
  _crtvd_result_length(r: number): number;
  _crtvd_result_palette(r: number): number;
  _crtvd_result_palette_length(r: number): number;
  _crtvd_result_free(r: number): void;
  _crtvd_palette_create(): number;
  _crtvd_palette_add(
    t: number,
    p: number,
    n: number,
    iw: number,
    ih: number,
    ow: number,
    oh: number,
    resample: number,
    seconds: number,
  ): number;
  _crtvd_palette_finish(t: number, colours: number): number;
  _crtvd_palette_free(t: number): void;
}
const palettes = { adaptive: 0, monochrome: 1, handheld: 2, cga: 3 };
const dithers = { none: 0, bayer: 1, floyd: 2 };
function integer(n: number, label: string, min: number, max: number) {
  if (!Number.isInteger(n) || n < min || n > max)
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
}
function validateFrame(frame: Frame) {
  integer(frame.width, 'Input width', 1, 16384);
  integer(frame.height, 'Input height', 1, 16384);
  if (frame.width * frame.height > 16777216)
    throw new RangeError('Input exceeds 16,777,216 pixels');
  if (
    !(frame.data instanceof Uint8Array || frame.data instanceof Uint8ClampedArray) ||
    frame.data.byteLength !== frame.width * frame.height * 4
  )
    throw new TypeError('Frame data must contain exactly width × height × 4 RGBA8 bytes');
}
function optionsFor(frame: Frame, o: ProcessOptions) {
  validateFrame(frame);
  const width = o.width ?? Math.min(160, frame.width);
  const height = o.height ?? Math.max(1, Math.round((width * frame.height) / frame.width));
  integer(width, 'Output width', 1, frame.width);
  integer(height, 'Output height', 1, frame.height);
  if (width * height > 1048576) throw new RangeError('Output exceeds 1,048,576 pixels');
  const palette = o.palette ?? 'adaptive',
    dither = o.dither ?? 'bayer',
    resample = o.resample ?? 'area';
  if (
    !Object.hasOwn(palettes, palette) ||
    !Object.hasOwn(dithers, dither) ||
    !['area', 'nearest'].includes(resample)
  )
    throw new TypeError('Unknown processing mode');
  const colours = o.colours ?? 16,
    strength = o.strength ?? 0.65;
  integer(colours, 'Colours', 2, 256);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new RangeError('Strength must be between zero and one');
  if (
    o.customPalette !== undefined &&
    (!(o.customPalette instanceof Uint8Array) ||
      o.customPalette.length < 3 ||
      o.customPalette.length > 768 ||
      o.customPalette.length % 3)
  )
    throw new TypeError('Custom palette must contain 1–256 packed RGB triplets');
  return { width, height, palette, dither, resample, colours, strength };
}

/** Owns one Wasm instance. Calls are synchronous; use a Worker for interactive apps. */
export class Processor {
  private pointer = 0;
  private capacity = 0;
  private disposed = false;
  private trainers = new Set<PaletteTrainer>();
  /** @internal Use createProcessor(). */
  constructor(private module: Module) {}
  /** @internal */
  assertOpen() {
    if (this.disposed) throw new Error('Processor has been disposed');
  }
  /** @internal */
  error() {
    return new Error(this.module.UTF8ToString(this.module._crtvd_last_error()));
  }
  private input(frame: Frame) {
    this.assertOpen();
    if (frame.data.byteLength > this.capacity) {
      if (this.pointer) this.module._free(this.pointer);
      this.pointer = 0;
      this.capacity = 0;
      this.pointer = this.module._malloc(frame.data.byteLength);
      if (!this.pointer) throw new Error('Wasm input allocation failed');
      this.capacity = frame.data.byteLength;
    }
    this.module.HEAPU8.set(frame.data, this.pointer);
    return this.pointer;
  }
  processFrame(frame: Frame, options: ProcessOptions = {}): ProcessedFrame {
    const started = performance.now();
    this.assertOpen();
    const o = optionsFor(frame, options),
      m = this.module;
    const pointer = this.input(frame);
    let pp = 0,
      result = 0;
    try {
      if (options.customPalette) {
        pp = m._malloc(options.customPalette.length);
        if (!pp) throw new Error('Wasm palette allocation failed');
        m.HEAPU8.set(options.customPalette, pp);
      }
      const before = performance.now();
      result = m._crtvd_process_palette(
        pointer,
        frame.data.byteLength,
        frame.width,
        frame.height,
        o.width,
        o.height,
        palettes[o.palette],
        o.colours,
        dithers[o.dither],
        o.strength,
        o.resample === 'area' ? 0 : 1,
        pp,
        options.customPalette?.length ?? 0,
      );
      const processingMs = performance.now() - before;
      if (!result) throw this.error();
      const p = m._crtvd_result_pixels(result),
        n = m._crtvd_result_length(result);
      const palette = m._crtvd_result_palette(result),
        pn = m._crtvd_result_palette_length(result);
      const data = m.HEAPU8.slice(p, p + n),
        rgb = m.HEAPU8.slice(palette, palette + pn);
      return {
        data,
        palette: rgb,
        width: o.width,
        height: o.height,
        processingMs,
        totalMs: performance.now() - started,
      };
    } finally {
      if (result) m._crtvd_result_free(result);
      if (pp) m._free(pp);
    }
  }
  createPaletteTrainer(options: ProcessOptions = {}): PaletteTrainer {
    this.assertOpen();
    const handle = this.module._crtvd_palette_create();
    if (!handle) throw this.error();
    const trainer = new PaletteTrainer(this, handle, options);
    this.trainers.add(trainer);
    return trainer;
  }
  /** @internal */
  addTraining(handle: number, frame: Frame, o: ProcessOptions, seconds: number) {
    this.assertOpen();
    const options = optionsFor(frame, o),
      pointer = this.input(frame);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30)
      throw new RangeError('Frame duration must be positive and at most 30 seconds');
    if (
      !this.module._crtvd_palette_add(
        handle,
        pointer,
        frame.data.byteLength,
        frame.width,
        frame.height,
        options.width,
        options.height,
        options.resample === 'area' ? 0 : 1,
        seconds,
      )
    )
      throw this.error();
  }
  /** @internal */
  finishTraining(handle: number, colours: number) {
    this.assertOpen();
    integer(colours, 'Colours', 2, 256);
    const m = this.module,
      r = m._crtvd_palette_finish(handle, colours);
    if (!r) throw this.error();
    try {
      const p = m._crtvd_result_palette(r),
        n = m._crtvd_result_palette_length(r);
      return m.HEAPU8.slice(p, p + n);
    } finally {
      m._crtvd_result_free(r);
    }
  }
  /** @internal */
  releaseTrainer(trainer: PaletteTrainer, handle: number) {
    if (this.trainers.delete(trainer)) this.module._crtvd_palette_free(handle);
  }
  /** Release the input allocation and all outstanding trainers. Idempotent. */
  dispose() {
    if (this.disposed) return;
    for (const trainer of [...this.trainers]) trainer.dispose();
    if (this.pointer) this.module._free(this.pointer);
    this.pointer = 0;
    this.capacity = 0;
    this.disposed = true;
  }
}

export class PaletteTrainer {
  private disposed = false;
  /** @internal */
  constructor(
    private owner: Processor,
    private handle: number,
    private options: ProcessOptions,
  ) {}
  addFrame(frame: Frame, seconds: number) {
    if (this.disposed) throw new Error('Palette trainer has been disposed');
    this.owner.addTraining(this.handle, frame, this.options, seconds);
  }
  /** Returns a palette snapshot; further frames may still be added. */
  finish(colours = 16) {
    if (this.disposed) throw new Error('Palette trainer has been disposed');
    return this.owner.finishTraining(this.handle, colours);
  }
  dispose() {
    if (!this.disposed) {
      this.owner.releaseTrainer(this, this.handle);
      this.disposed = true;
    }
  }
}

export async function createProcessor(options: CreateOptions = {}): Promise<Processor> {
  const loader = new URL(options.loaderUrl ?? './wasm/crtvd.js', import.meta.url);
  const wasm = new URL(options.wasmUrl ?? 'crtvd.wasm', loader);
  const { default: create } = await import(/* @vite-ignore */ loader.href);
  const module: Module = await create({
    locateFile: (name: string) => (name.endsWith('.wasm') ? wasm.href : new URL(name, loader).href),
    ...(options.wasmBinary ? { wasmBinary: new Uint8Array(options.wasmBinary) } : {}),
  });
  if (
    typeof module._crtvd_process_palette !== 'function' ||
    typeof module._crtvd_palette_create !== 'function'
  )
    throw new Error(
      'Incompatible Wasm build; rebuild the engine and deploy its loader/binary pair together',
    );
  return new Processor(module);
}
