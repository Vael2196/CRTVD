import type { AnimationModule, AnimationRequest, AnimationResponse, ClipSource } from './types';
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
    const { default: create } = await import(/* @vite-ignore */ url.href);
    const module: AnimationModule = await create({
      locateFile: (name: string) => new URL(name, url).href,
    });
    const settings = {
      ...o.settings,
      colours: Math.min(o.settings.colours, o.format === 'gif' ? 255 : 256),
    };
    processor = new FrameProcessor(module, width, height, settings);
    // Negotiate the output before spending time on the palette pass.
    writer =
      o.format === 'gif'
        ? gifWriter(width, height, clip.info.repeat)
        : await videoWriter(o.format, width, height, o.fps);
    const total = clip.info.frameCount ?? Math.ceil(clip.info.duration * o.fps - 1e-7);
    const shared = settings.palette === 'adaptive';
    let count = 0;
    if (shared) {
      for await (const frame of clip.frames(o.fps)) {
        if (++count > LIMITS.frames) throw new Error('The clip exceeds 900 frames.');
        processor.train(o.format === 'gif' ? frame : flattenFrame(frame, o.matte));
        scope.postMessage({
          type: 'progress',
          phase: 'palette',
          fraction: (0.5 * count) / total,
          frame: count,
        });
      }
      processor.finishTraining(settings.colours);
    }
    count = 0;
    let palette: number[] = [];
    for await (const frame of clip.frames(o.fps)) {
      if (++count > LIMITS.frames) throw new Error('The clip exceeds 900 frames.');
      const result = processor.process(o.format === 'gif' ? frame : flattenFrame(frame, o.matte));
      if (!palette.length) palette = Array.from(result.palette);
      await writer.add(result.rgba, result.palette, frame.timestamp, frame.duration);
      scope.postMessage({
        type: 'progress',
        phase: 'encoding',
        fraction: (shared ? 0.5 : 0) + ((shared ? 0.5 : 1) * count) / total,
        frame: count,
      });
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
    processor?.dispose();
    clip?.dispose();
    busy = false;
  }
};
