import { uniqueColours } from '../palettes';
import type { PaletteTrainer } from '@vael2196/crtvd';
import { createProcessor } from '@vael2196/crtvd';
import type { AnimationRequest, AnimationResponse, ClipSource } from './types';
import { openClip } from './video';
import { FrameProcessor, flattenFrame } from './processor';
import { gifWriter, videoWriter } from './encode';
import type { FrameWriter } from './encode';
import { animationSize, validateOptions, LIMITS } from './limits';

const scope = self as unknown as {
  location: Location;
  onmessage: ((event: MessageEvent<AnimationRequest>) => void) | null;
  postMessage(message: AnimationResponse, transfer?: Transferable[]): void;
};
let busy = false;
scope.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  let clip: ClipSource | undefined;
  let processor: FrameProcessor | undefined;
  let effectTrainer: PaletteTrainer | undefined;
  let disposeEngine: (() => void) | undefined;
  let writer: FrameWriter | undefined;
  let finished = false;
  try {
    clip = await openClip(data.file);
    if (data.type === 'probe') {
      scope.postMessage({ type: 'info', info: clip.info });
      return;
    }
    validateOptions(data.options);
    const o = data.options;
    const { width, height } = animationSize(clip.info, o.settings.targetWidth);
    const url = new URL(`${import.meta.env.BASE_URL}wasm/crtvd.js`, scope.location.origin);
    const engine = await createProcessor({ loaderUrl: url });
    // An already analysed clip can preview with its full palette. Explicit
    // palettes and manual edits still take precedence in FrameProcessor.
    const settings = {
      ...o.settings,
      colours: Math.min(o.settings.colours, o.format === 'gif' ? 255 : 256),
      customPalette:
        o.settings.customPalette ?? (data.type === 'preview' ? data.trainedPalette : undefined),
    };
    disposeEngine = () => engine.dispose();
    const gif = o.format === 'gif';
    processor = new FrameProcessor(engine, width, height, settings, gif ? 255 : 256);
    const prepare = (frame: Parameters<FrameProcessor['process']>[0]) =>
      gif ? frame : flattenFrame(frame, o.matte);
    if (data.type === 'preview') {
      for await (const frame of clip.frames(o.fps)) {
        const result = processor.process(prepare(frame));
        const rgba = result.rgba.buffer;
        scope.postMessage(
          {
            type: 'preview',
            width,
            height,
            rgba,
            palette: Array.from(result.palette),
            originalPalette: Array.from(result.originalPalette),
          },
          [rgba],
        );
        return;
      }
      throw new Error('The clip contains no frames to preview.');
    }
    writer = gif
      ? gifWriter(width, height, clip.info.repeat)
      : await videoWriter(o.format === 'mp4' ? 'mp4' : 'webm', width, height, o.fps);
    const total = clip.info.frameCount ?? Math.ceil(clip.info.duration * o.fps - 1e-7);
    const shared = processor.needsTraining;
    const compositeGif = gif && processor.activeEffects;
    const stages = 1 + Number(shared) + Number(compositeGif);
    let stage = 0;
    const progress = (phase: 'palette' | 'effects' | 'encoding', count: number) => {
      if (count === 1 || count === total || count % 4 === 0)
        scope.postMessage({
          type: 'progress',
          phase,
          fraction: (stage + count / total) / stages,
          frame: count,
        });
    };
    const check = (count: number) => {
      if (count > LIMITS.frames) throw new Error('The clip exceeds 900 frames.');
    };
    if (shared) {
      let count = 0;
      for await (const frame of clip.frames(o.fps)) {
        check(++count);
        processor.train(prepare(frame));
        progress('palette', count);
      }
      processor.finishTraining(settings.colours);
      stage++;
    }
    let gifPalette: Uint8Array | undefined;
    if (compositeGif) {
      // GIF has one shared RGB table plus the transparent index. Keep the
      // user's colours, then learn additional source/fringe colours across
      // the clip without holding decoded frames in memory.
      let base: number[] = [];
      let count = 0;
      for await (const frame of clip.frames(o.fps)) {
        check(++count);
        const result = processor.process(frame);
        if (count === 1) {
          base = uniqueColours(result.palette);
          if (base.length === 255 * 3) break;
          effectTrainer = engine.createPaletteTrainer({ width, height });
        }
        effectTrainer?.addFrame({ data: result.rgba, width, height }, frame.duration);
        progress('effects', count);
      }
      const extra = effectTrainer?.finish(Math.max(2, 255 - base.length / 3));
      gifPalette = Uint8Array.from(uniqueColours([...base, ...(extra ?? [])]).slice(0, 255 * 3));
      effectTrainer?.dispose();
      effectTrainer = undefined;
      stage++;
    }
    let count = 0;
    let palette: number[] = [];
    let originalPalette: number[] = [];
    for await (const frame of clip.frames(o.fps)) {
      check(++count);
      const result = processor.process(prepare(frame));
      if (count === 1) {
        palette = Array.from(result.palette);
        originalPalette = Array.from(result.originalPalette);
      }
      if (gifPalette) {
        const indexed = engine.processFrame(
          { data: result.rgba, width, height },
          { width, height, customPalette: gifPalette, dither: 'none' },
        );
        await writer.add(indexed.data, gifPalette, frame.timestamp, frame.duration);
      } else {
        await writer.add(result.rgba, result.palette, frame.timestamp, frame.duration);
      }
      progress('encoding', count);
    }
    const bytes = await writer.finish();
    finished = true;
    const buffer = bytes.slice().buffer;
    scope.postMessage(
      {
        type: 'done',
        bytes: buffer,
        mime: o.format === 'gif' ? 'image/gif' : `video/${o.format}`,
        extension: o.format,
        width: o.format === 'mp4' ? Math.ceil(width / 2) * 2 : width,
        height: o.format === 'mp4' ? Math.ceil(height / 2) * 2 : height,
        frames: count,
        duration: clip.info.duration,
        palette,
        originalPalette,
      },
      [buffer],
    );
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Animation conversion failed.',
    });
  } finally {
    if (writer && !finished)
      try {
        await writer.cancel();
      } catch {
        /* Preserve the original error. */
      }
    effectTrainer?.dispose();
    if (processor) processor.dispose();
    else disposeEngine?.();
    clip?.dispose();
    busy = false;
  }
};
