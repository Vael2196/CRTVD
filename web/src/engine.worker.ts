import type { CrtvdModule, WorkerRequest, WorkerResponse } from './types';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  location: Location;
};

let engine: CrtvdModule;
let source:
  | { pointer: number; length: number; width: number; height: number; generation: number }
  | undefined;

async function initialise() {
  const url = new URL(`${import.meta.env.BASE_URL}wasm/crtvd.js`, worker.location.origin);
  const { default: createCrtvd } = await import(/* @vite-ignore */ url.href);
  engine = await createCrtvd({ locateFile: (name: string) => new URL(name, url).href });
  worker.postMessage({ type: 'ready' });
}

const initialised = initialise();
initialised.catch(() =>
  worker.postMessage({
    type: 'error',
    message:
      'The image engine could not start. Build it with npm run build:wasm, then reload the page.',
  }),
);

// Promise chaining keeps source replacement and processing ordered while the
// module initialises. CPU work is synchronous here, on the worker thread.
let queue = initialised;
worker.onmessage = ({ data }) => {
  queue = queue
    .then(() => {
      if (data.type === 'source') {
        if (
          data.width < 1 ||
          data.height < 1 ||
          data.width > 16384 ||
          data.height > 16384 ||
          data.width * data.height > 16777216 ||
          data.rgba.byteLength !== data.width * data.height * 4
        )
          throw new Error('Invalid image dimensions or pixel buffer.');
        // Release the previous source first to avoid retaining two large uploads.
        if (source) {
          engine._free(source.pointer);
          source = undefined;
        }
        const pointer = engine._malloc(data.rgba.byteLength);
        if (!pointer) throw new Error('Not enough memory to load this image. Try a smaller file.');
        engine.HEAPU8.set(new Uint8Array(data.rgba), pointer);
        source = {
          pointer,
          length: data.rgba.byteLength,
          width: data.width,
          height: data.height,
          generation: data.generation,
        };
        worker.postMessage({ type: 'source-ready', generation: data.generation });
        return;
      }
      if (!source || source.generation !== data.generation) return;
      const started = performance.now();
      const palettes = { adaptive: 0, monochrome: 1, handheld: 2, cga: 3 };
      const dithers = { none: 0, bayer: 1, floyd: 2 };
      const o = data.settings;
      const result = engine._crtvd_process(
        source.pointer,
        source.length,
        source.width,
        source.height,
        data.width,
        data.height,
        palettes[o.palette],
        o.colours,
        dithers[o.dither],
        o.strength,
        o.resample === 'area' ? 0 : 1,
      );
      if (!result) throw new Error(engine.UTF8ToString(engine._crtvd_last_error()));
      try {
        const pointer = engine._crtvd_result_pixels(result);
        const length = engine._crtvd_result_length(result);
        // Wasm memory can grow during allocation: use its current HEAPU8 view.
        // Copy before freeing C++ memory or transferring the result to React.
        const rgba = engine.HEAPU8.slice(pointer, pointer + length).buffer;
        const pp = engine._crtvd_result_palette(result);
        const pl = engine._crtvd_result_palette_length(result);
        const palette = Array.from(engine.HEAPU8.subarray(pp, pp + pl));
        worker.postMessage(
          {
            type: 'result',
            id: data.id,
            generation: data.generation,
            width: data.width,
            height: data.height,
            rgba,
            palette,
            milliseconds: performance.now() - started,
          },
          [rgba],
        );
      } finally {
        engine._crtvd_result_free(result);
      }
    })
    .catch((error: unknown) => {
      worker.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Image processing failed.',
        generation: data.generation,
        id: data.type === 'process' ? data.id : undefined,
      });
    });
};
