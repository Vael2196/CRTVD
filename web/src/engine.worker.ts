import { createProcessor } from '@vael2196/crtvd';
import type { Processor, Frame, ProcessedFrame } from '@vael2196/crtvd';
import { quantisationPalette, remapPalette } from './palettes';
import { FrameComposer } from './layers';
import type { WorkerRequest, WorkerResponse } from './types';
const worker = self as unknown as {
  location: Location;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerResponse, t?: Transferable[]): void;
};
let engine: Processor;
let source: { frame: Frame; generation: number } | undefined;
const initialised = (async () => {
  engine = await createProcessor({
    loaderUrl: new URL(`${import.meta.env.BASE_URL}wasm/crtvd.js`, worker.location.origin),
  });
  worker.postMessage({ type: 'ready' });
})();
initialised.catch(() =>
  worker.postMessage({
    type: 'error',
    message: 'The engine could not start. Run npm run build:wasm and reload.',
  }),
);
let queue = initialised;
let cached: { key: string; result: ProcessedFrame } | undefined;
worker.onmessage = ({ data }) => {
  queue = queue
    .then(() => {
      if (data.type === 'source') {
        if (
          data.rgba.byteLength !== data.width * data.height * 4 ||
          data.width < 1 ||
          data.height < 1 ||
          data.width > 16384 ||
          data.height > 16384 ||
          data.width * data.height > 16777216
        )
          throw new Error('Invalid source frame');
        source = {
          generation: data.generation,
          frame: { data: new Uint8Array(data.rgba), width: data.width, height: data.height },
        };
        cached = undefined;
        worker.postMessage({ type: 'source-ready', generation: data.generation });
        return;
      }
      if (!source || source.generation !== data.generation) return;
      const o = data.settings;
      const started = performance.now();
      const custom = quantisationPalette(o);
      const { width, height } = data;
      const key = JSON.stringify([
        width,
        height,
        o.resample,
        o.dither,
        o.strength,
        o.palette,
        o.colours,
        custom && Array.from(custom),
      ]);
      if (cached?.key !== key)
        cached = {
          key,
          result: engine.processFrame(source.frame, { ...o, width, height, customPalette: custom }),
        };
      const result = cached.result;
      const composer = new FrameComposer(source.frame.width, source.frame.height, width, height, o);
      const {
        rgba: pixels,
        slots,
        visibleColours,
      } = composer.render(
        source.frame.data,
        remapPalette(o.paletteEdit)(result.data),
        result.data,
        result.palette,
        true,
      );
      // The cache owns the original conversion; transfer only a fresh buffer.
      const rgba = (pixels === result.data ? pixels.slice() : pixels).buffer;
      worker.postMessage(
        {
          type: 'result',
          id: data.id,
          generation: data.generation,
          width: composer.width,
          height: composer.height,
          rgba,
          slots: slots?.buffer,
          palette: o.paletteEdit?.colours ?? Array.from(result.palette),
          visibleColours,
          originalPalette: Array.from(result.palette),
          milliseconds: performance.now() - started,
        },
        slots ? [rgba, slots.buffer] : [rgba],
      );
    })
    .catch((error) =>
      worker.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Processing failed',
        generation: data.generation,
        id: data.type === 'process' ? data.id : undefined,
      }),
    );
};
