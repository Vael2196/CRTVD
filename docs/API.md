# CRTVD 0.3 API and native CLI

## TypeScript/Wasm package

Build the engine and package from the repository root:

```bash
source ~/tools/emsdk/emsdk_env.sh
npm ci
npm run build
npm run pack:sdk
```

The resulting `release/vael2196-crtvd-0.3.0.tgz` is a real npm package. Copy it
to another project and run `npm install /path/to/vael2196-crtvd-0.3.0.tgz`.
No registry account is needed for this route. Registry publication is separate;
use a package name/scope you own before running `npm publish`.

The package includes ESM JavaScript, TypeScript declarations, source maps,
source, the matching Wasm loader/binary, build metadata and licence notices.
It has no runtime npm dependencies. Browser media codecs are part of the app,
not the processing package.
The declaration files require TypeScript 5.7+; Node execution requires 22.12+.

### Loading

```ts
import { createProcessor } from '@vael2196/crtvd';
const processor = await createProcessor({ loaderUrl: '/wasm/crtvd.js' });
```

Use an absolute URL for a path beginning `/` when running in a worker:
`new URL('/wasm/crtvd.js', self.location.origin)`. Copy the package's `lib/wasm`
directory to that public location, or import both exported assets with Vite
`?url` and pass `{loaderUrl, wasmUrl}`. Node can supply `wasmBinary` using
`readFile(new URL(import.meta.resolve('@vael2196/crtvd/wasm/crtvd.wasm')))`. The
default asset URLs work when executing the package unbundled; bundlers should
receive explicit public/imported URLs so their asset copying is predictable.

### `processor.processFrame(frame, options)`

`frame` contains `{data, width, height}`. Data is exactly width × height × 4
bytes in straight-alpha, sRGB RGBA8. A `Uint8Array` or `Uint8ClampedArray` is
accepted. The input is not mutated.

| Option          | Default               | Values                                      |
| --------------- | --------------------- | ------------------------------------------- |
| `width`         | min(160, input width) | Positive integer, no upscaling              |
| `height`        | Preserve aspect ratio | Positive integer, no upscaling              |
| `palette`       | `adaptive`            | `adaptive`, `monochrome`, `handheld`, `cga` |
| `colours`       | 16                    | 2–256                                       |
| `dither`        | `bayer`               | `none`, `bayer`, `floyd`                    |
| `strength`      | 0.65                  | Finite value from 0 to 1                    |
| `resample`      | `area`                | `area`, `nearest`                           |
| `customPalette` | None                  | 1–256 packed RGB triplets, as `Uint8Array`  |

The result contains `{data, palette, width, height, processingMs, totalMs}`.
Both byte arrays are caller-owned copies and remain valid after another call
or disposal. `processingMs` covers the Wasm C API call, including its native
allocations. `totalMs` also covers validation and JS/Wasm copies. Codec I/O,
worker scheduling and rendering are excluded.

Input limits: 16,777,216 pixels and 16,384 per side. Output limit: 1,048,576
pixels. The smaller limits in the animation editor are application policy.
There is no HDR/ICC management. Floating-point ties can differ across compilers;
do not assume byte identity between every native/Wasm toolchain.

Calls are synchronous. Initialise and use the processor in a Web Worker for
interactive UIs. One instance owns its buffers; do not share its raw Wasm
memory. Reusing the processor reuses its input allocation.

### Clip palette lifecycle

```ts
const trainer = processor.createPaletteTrainer({ width: 160, resample: 'area' });
try {
  for (const frame of sourceFrames) trainer.addFrame(frame, frameDurationSeconds);
  const customPalette = trainer.finish(16);
  // Re-read the source frames and processFrame(frame,{width:160,customPalette}).
} finally {
  trainer.dispose();
}
processor.dispose();
```

Each duration must be positive, finite and at most 30 seconds. The trainer
owns an approximately 1 MiB histogram, with up to 4,096 samples per frame.
`finish()` returns a snapshot, and further training remains possible. Dispose
the trainer after the analysis pass. Processor disposal also disposes all
remaining trainers. Both disposal calls are idempotent; use after disposal
throws. Releasing allocations does not shrink the Wasm memory; release the
instance or terminate its worker when finished with it.

## Native CLI

On Arch install `base-devel`, or provide a C++20 compiler using `CXX=clang++`.
No Emscripten is required for native builds:

```bash
npm run build:native
./build/native-release/crtvd input.jpg output.png --width 160 --colours 16 --dither bayer
```

For a CMake install:

```bash
cmake -S . -B build/cmake -DCMAKE_BUILD_TYPE=Release
cmake --build build/cmake
ctest --test-dir build/cmake --output-on-failure
cmake --install build/cmake --prefix "$HOME/.local"
```

Use `crtvd --help` for all options. The CLI uses the same engine and option
values, with optional `--palette-in FILE.hex`, `--palette-out FILE.hex` and
`--report FILE.json`. Palette files contain one `#RRGGBB` colour per line.
Blank lines and lines beginning `;` or `//` are ignored. `--colors` is an alias
for `--colours`.

```bash
./build/native-release/crtvd input.png output.png \
  --width 160 --palette handheld --dither floyd --strength 0.8 \
  --palette-out output.hex --report output.json
```

The CLI reads PNG/JPEG still images and writes RGBA PNG. GIF/video conversion
remains in the web app. JPEG EXIF orientation, ICC profiles and HDR are not
interpreted; normalise such inputs before native conversion if necessary.
The selected output dimensions cannot upscale. Existing outputs require
`--force`; input and output paths must be distinct. PNG output is written to
a temporary sibling and renamed after successful encoding. Native rename
replacement with `--force` follows platform filesystem semantics (tested on
Linux). Optional report/palette output is written after the PNG.

Exit status: 0 success/help/version, 2 invalid arguments or engine options,
1 image/file I/O or processing failure. The JSON report records engine time,
dimensions and RGB palette; file decode/encode time is not included.

The image codecs are pinned, vendored stb headers. Their source revision and
SHA-256 values are in `engine/vendor/README.md`; build does not download them.
