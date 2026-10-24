import type { Processor, PaletteTrainer } from '@vael2196/crtvd';
import type { ClipFrame } from './types';
import type { Settings } from '../types';

export class FrameProcessor {
  private trainer: PaletteTrainer | undefined;
  private palette: Uint8Array | undefined;
  constructor(
    private engine: Processor,
    private width: number,
    private height: number,
    private settings: Settings,
  ) {}
  private options() {
    return { ...this.settings, width: this.width, height: this.height };
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
    return { rgba: result.data, palette: result.palette };
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
