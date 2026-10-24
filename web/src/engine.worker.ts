import { createProcessor } from '@vael2196/crtvd';
import type { Processor, Frame } from '@vael2196/crtvd';
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
        worker.postMessage({ type: 'source-ready', generation: data.generation });
        return;
      }
      if (!source || source.generation !== data.generation) return;
      const o = data.settings;
      const result = engine.processFrame(source.frame, {
        ...o,
        width: data.width,
        height: data.height,
      });
      const rgba = result.data.buffer;
      worker.postMessage(
        {
          type: 'result',
          id: data.id,
          generation: data.generation,
          width: result.width,
          height: result.height,
          rgba,
          palette: Array.from(result.palette),
          milliseconds: result.totalMs,
        },
        [rgba],
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
