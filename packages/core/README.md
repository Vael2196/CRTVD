# @vael2196/crtvd

Framework-independent C++/WebAssembly resampling, palette quantisation and
dithering. Version 0.3.0, ESM, with TypeScript declarations and Wasm assets.
The declarations require TypeScript 5.7 or newer; Node use requires 22.12+.

The release tarball can be installed without publishing it to a registry:

```bash
npm install ./vael2196-crtvd-0.3.0.tgz
```

## Browser / worker

Copy the package's `lib/wasm/` files into your application's public `/wasm/`
directory, then initialise in a Web Worker:

```ts
import { createProcessor } from '@vael2196/crtvd';

const processor = await createProcessor({
  loaderUrl: new URL('/wasm/crtvd.js', self.location.origin),
});
try {
  const result = processor.processFrame(
    { data: rgbaBytes, width: 960, height: 640 },
    { width: 160, colours: 16, palette: 'adaptive', dither: 'bayer', resample: 'area' },
  );
  // result.data is owned RGBA8; result.palette is packed RGB.
} finally {
  processor.dispose();
}
```

With Vite you can instead import both assets using `?url` and supply `loaderUrl`
and `wasmUrl`. The loader and binary must come from the same build:

```ts
import loaderUrl from '@vael2196/crtvd/wasm/crtvd.js?url';
import wasmUrl from '@vael2196/crtvd/wasm/crtvd.wasm?url';
const processor = await createProcessor({ loaderUrl, wasmUrl });
```

## Node

```ts
import { readFile } from 'node:fs/promises';
import { createProcessor } from '@vael2196/crtvd';
const wasmBinary = await readFile(new URL(import.meta.resolve('@vael2196/crtvd/wasm/crtvd.wasm')));
const processor = await createProcessor({ wasmBinary });
```

Decode files separately before passing RGBA8. This package supplies image
transforms; codecs and DOM rendering belong to the host application.

## Clip palettes

```ts
const trainer = processor.createPaletteTrainer({ width: 160, resample: 'area' });
try {
  for (const frame of frames) trainer.addFrame(frame, 0.1);
  const customPalette = trainer.finish(16);
  for (const frame of frames) {
    const output = processor.processFrame(frame, { width: 160, customPalette });
    // Send each output to your encoder or renderer.
  }
} finally {
  trainer.dispose();
}
```

Pass each frame's actual display duration in seconds. Training stores a bounded
histogram; re-read frames for the processing pass. `finish` returns a snapshot;
it does not dispose the trainer. A processor disposes any remaining trainers.

`processFrame` is synchronous. Use a worker for interactive applications. Input
is not mutated; output arrays are copies owned by the caller and survive future
calls/disposal. `processingMs` measures the engine call; `totalMs` also includes
validation and JS/Wasm copies. `dispose` frees working allocations but the Wasm
instance's linear memory remains until the instance is garbage-collected.

Output never upscales. Inputs: at most 16,777,216 pixels and 16,384 pixels per
side. Outputs: at most 1,048,576 pixels. Colours: 2–256; custom palettes accept
1–256 packed RGB triplets. Strength: 0–1. Input/output are straight-alpha sRGB
RGBA8. There is no ICC/HDR handling. See the project `docs/API.md` for all options.

Project source and reference fixtures: https://github.com/Vael2196/CRTVD
