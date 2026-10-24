import type { AnimationModule, ClipFrame } from './types';
import type { Settings } from '../types';

export class FrameProcessor {
  private pointer = 0;
  private capacity = 0;
  private palettePointer = 0;
  private paletteLength = 0;
  private trainer = 0;
  constructor(
    private module: AnimationModule,
    private width: number,
    private height: number,
    private settings: Settings,
  ) {
    if (typeof module._crtvd_palette_create !== 'function')
      throw new Error('The Wasm engine is from an older build. Run npm run build:wasm and reload.');
  }
  private input(frame: ClipFrame) {
    if (frame.rgba.byteLength > this.capacity) {
      if (this.pointer) this.module._free(this.pointer);
      this.pointer = 0;
      this.capacity = 0;
      this.pointer = this.module._malloc(frame.rgba.byteLength);
      if (!this.pointer) throw new Error('Not enough memory to process this animation.');
      this.capacity = frame.rgba.byteLength;
    }
    this.module.HEAPU8.set(frame.rgba, this.pointer);
  }
  private error() {
    return new Error(this.module.UTF8ToString(this.module._crtvd_last_error()));
  }
  train(frame: ClipFrame) {
    if (!this.trainer) {
      this.trainer = this.module._crtvd_palette_create();
      if (!this.trainer) throw this.error();
    }
    this.input(frame);
    const ok = this.module._crtvd_palette_add(
      this.trainer,
      this.pointer,
      frame.rgba.byteLength,
      frame.width,
      frame.height,
      this.width,
      this.height,
      this.settings.resample === 'area' ? 0 : 1,
      frame.duration,
    );
    if (!ok) throw this.error();
  }
  finishTraining(colours: number) {
    const result = this.module._crtvd_palette_finish(this.trainer, colours);
    if (!result) throw this.error();
    try {
      const pointer = this.module._crtvd_result_palette(result),
        length = this.module._crtvd_result_palette_length(result);
      this.setPalette(this.module.HEAPU8.slice(pointer, pointer + length));
    } finally {
      this.module._crtvd_result_free(result);
    }
    this.module._crtvd_palette_free(this.trainer);
    this.trainer = 0;
  }
  private setPalette(palette: Uint8Array) {
    if (this.palettePointer) this.module._free(this.palettePointer);
    this.palettePointer = this.module._malloc(palette.length);
    if (!this.palettePointer) throw new Error('Palette allocation failed.');
    this.module.HEAPU8.set(palette, this.palettePointer);
    this.paletteLength = palette.length;
  }
  process(frame: ClipFrame) {
    this.input(frame);
    const s = this.settings;
    const result = this.module._crtvd_process_palette(
      this.pointer,
      frame.rgba.byteLength,
      frame.width,
      frame.height,
      this.width,
      this.height,
      { adaptive: 0, monochrome: 1, handheld: 2, cga: 3 }[s.palette],
      s.colours,
      { none: 0, bayer: 1, floyd: 2 }[s.dither],
      s.strength,
      s.resample === 'area' ? 0 : 1,
      this.palettePointer,
      this.paletteLength,
    );
    if (!result) throw this.error();
    try {
      const p = this.module._crtvd_result_pixels(result),
        n = this.module._crtvd_result_length(result);
      const pp = this.module._crtvd_result_palette(result),
        pn = this.module._crtvd_result_palette_length(result);
      return {
        rgba: this.module.HEAPU8.slice(p, p + n),
        palette: this.module.HEAPU8.slice(pp, pp + pn),
      };
    } finally {
      this.module._crtvd_result_free(result);
    }
  }
  dispose() {
    if (this.pointer) this.module._free(this.pointer);
    if (this.palettePointer) this.module._free(this.palettePointer);
    if (this.trainer) this.module._crtvd_palette_free(this.trainer);
    this.pointer = 0;
    this.palettePointer = 0;
    this.trainer = 0;
    this.capacity = 0;
    this.paletteLength = 0;
  }
}

const linear = Array.from({ length: 256 }, (_, n) =>
  n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4,
);
const encoded = (x: number) =>
  Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));
export function flattenFrame(frame: ClipFrame, matte: string) {
  // GIF frames borrow the compositor's screen. Never mutate it: doing so
  // would destroy transparency needed for disposal of subsequent frames.
  frame = { ...frame, rgba: frame.rgba.slice() };
  const bg = [1, 3, 5].map((i) => linear[parseInt(matte.slice(i, i + 2), 16)]);
  for (let i = 0; i < frame.rgba.length; i += 4) {
    if (frame.rgba[i + 3] === 255) continue;
    const alpha = frame.rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      frame.rgba[i + c] = encoded(linear[frame.rgba[i + c]] * alpha + bg[c] * (1 - alpha));
    frame.rgba[i + 3] = 255;
  }
  return frame;
}
