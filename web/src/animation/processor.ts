import type { Processor, PaletteTrainer } from '@vael2196/crtvd';
import type { ClipFrame } from './types';
import type { Settings } from '../types';
import { quantisationPalette, remapPalette } from '../palettes';
import { effectEnabled, EffectRenderer } from '../effects';

export class FrameProcessor {
  private trainer: PaletteTrainer | undefined;
  private palette: Uint8Array | undefined;
  private recolour: ReturnType<typeof remapPalette>;
  private effects?: EffectRenderer;
  constructor(
    private engine: Processor,
    private width: number,
    private height: number,
    private settings: Settings,
    maxColours = 256,
  ) {
    this.palette = quantisationPalette(settings, maxColours);
    this.recolour = remapPalette(settings.paletteEdit);
    if (effectEnabled(settings.effects))
      this.effects = new EffectRenderer(width, height, settings.effects);
  }
  get needsTraining() {
    return !this.palette && this.settings.palette === 'adaptive';
  }
  get activeEffects() {
    return !!this.effects;
  }
  private options() {
    const { palette, dither, strength, resample, colours } = this.settings;
    return { palette, dither, strength, resample, colours, width: this.width, height: this.height };
  }
  train(frame: ClipFrame) {
    this.trainer ??= this.engine.createPaletteTrainer(this.options());
    this.trainer.addFrame(
      { data: frame.rgba, width: frame.width, height: frame.height },
      frame.duration,
    );
  }
  finishTraining(colours: number) {
    if (!this.trainer) throw new Error('No palette training frames');
    this.palette = this.trainer.finish(colours);
    this.trainer.dispose();
    this.trainer = undefined;
  }
  process(frame: ClipFrame) {
    const result = this.engine.processFrame(
      { data: frame.rgba, width: frame.width, height: frame.height },
      { ...this.options(), customPalette: this.palette },
    );
    let rgba = this.recolour(result.data);
    if (this.effects) rgba = this.effects.apply(frame.rgba, frame.width, frame.height, rgba);
    return {
      rgba,
      palette: this.settings.paletteEdit
        ? Uint8Array.from(this.settings.paletteEdit.colours)
        : result.palette,
      originalPalette: result.palette,
    };
  }
  dispose() {
    this.trainer?.dispose();
    this.trainer = undefined;
    this.engine.dispose();
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
