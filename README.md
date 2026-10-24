# CRT Visual Downscaler

**CRTVD** turns photographs, GIFs and short videos into small, palette-limited
visual assets. Its reusable C++20 engine runs in the browser through WebAssembly.
The React interface handles still-image previews, animation jobs and local export.

**Version 0.3: reusable engine, native CLI and a refreshed early-web interface.** No uploads, accounts or backend service
are required. CRT display simulation is a separate future stage.

## Features

- Linear-light area downsampling or nearest-neighbour sampling.
- Adaptive palettes with Oklab colour matching, plus three fixed palettes.
- Bayer ordered dithering and serpentine Floyd–Steinberg error diffusion.
- Transparency-aware filtering and exact pixel-scale PNG export.
- A duration-weighted **shared palette across an animation**, rather than a new
  adaptive palette for each frame.
- GIF patch compositing, disposal 0–3, local palettes, interlacing, original
  delays and loop metadata.
- Browser-native video decoding and encoding, with runtime codec checks.
- Frame-by-frame processing, explicit progress and immediate cancellation.

## Run locally

The repository root contains `package.json`, `engine/`, `web/` and `.github/`.
Use Node.js 22.12+ (24 LTS recommended), Python 3, and Emscripten **6.0.13**.

```bash
source ~/tools/emsdk/emsdk_env.sh
npm ci
npm run build:wasm
npm run dev
```

Open the local URL printed by Vite. Start with **Still image**, or choose
**Animation → Try the moving landscape → Convert animation**.

Emscripten setup and upgrade commands are in
[docs/UPGRADING_0_2.md](docs/UPGRADING_0_2.md).
For this release's patch, test fix and package commands, see
[docs/UPGRADING_0_3.md](docs/UPGRADING_0_3.md).

## Reusable release

- `@vael2196/crtvd`: framework-independent ESM/TypeScript package with matching
  Wasm assets, caller-owned output buffers and clip palette training.
- Native `crtvd` CLI: PNG/JPEG to palette-limited PNG, optional palette/report
  files, built from the same C++ engine.
- Frozen reference PNGs checked through both native and Wasm paths.
- [Measured benchmarks](benchmarks/RESULTS.md), raw runs and a static public
  report at `/benchmarks.html` after deployment.
- Automatic fresh UI builds and an isolated server for Playwright, fixing tests
  that previously served an old `dist` without the Animation navigation.

```bash
npm run build:native
./build/native-release/crtvd input.jpg output.png --width 160 --colours 16
npm run pack:sdk
```

Install the tarball in `release/` into another project. This local package route
needs no registry account. Full usage and lifecycle rules: [docs/API.md](docs/API.md).
The native CLI is currently a still-image tool; GIF/video codecs remain in the
web app. Benchmark values are measured on a shared Linux host, not guarantees
for a visitor's browser.

## Supported animation profiles

| Direction | Container       | Codec       | Behaviour                                         |
| --------- | --------------- | ----------- | ------------------------------------------------- |
| Input     | GIF87a / GIF89a | GIF LZW     | Original image frames, delays and repeat metadata |
| Input     | MP4             | H.264 / AVC | SDR; browser decoder required                     |
| Input     | WebM            | VP8 or VP9  | SDR; browser decoder required                     |
| Output    | GIF             | GIF LZW     | One global palette; binary transparency           |
| Output    | WebM            | VP8         | Silent, opaque, lossy; browser encoder required   |
| Output    | MP4             | H.264 / AVC | Silent, opaque, lossy; browser encoder required   |

All supported input profiles can be converted to any supported output profile.
Video inputs are sampled at the selected 10–30 fps. GIF inputs retain their
original frame timing even when exported as video. GIF outputs round absolute
frame boundaries to centiseconds to avoid cumulative timing drift.

**Video exports omit audio**, including when the input contains it. The editor
shows this before conversion. Lossy video encoding may introduce nearby RGB
values beyond the engine's palette; GIF/PNG preserve the palette RGB values.

HEVC/H.265, AV1, MOV, HDR, live media and variable-resolution streams are outside
this release. An `.mp4` extension alone does not guarantee a supported codec.

## Limits and transparency

- Up to **30 seconds**. GIF input is limited to **900 image frames**; video
  sampling is limited to **900 output frames**. Longer clips are rejected rather
  than silently truncated.
- GIF inputs: **16 MiB**. Video inputs: **64 MiB**. Encoded outputs: **64 MiB**.
- Input frames: at most **2,073,600 pixels**, and at most **4,096 pixels per side**.
  Video coded dimensions are checked as well as display dimensions.
- Animation processing resolution: at most **512 pixels wide** and **262,144 total pixels**.
  Height follows the source aspect ratio; outputs do not upscale the source.
- GIF export reserves palette index zero for transparency. An adaptive request
  of 256 colours therefore uses at most 255 RGB entries plus transparency.
- GIF alpha is binary: alpha below 128 becomes transparent, otherwise opaque.
  Video exports composite transparent pixels onto the chosen background in
  linear light. MP4 pads odd dimensions by one black pixel on the right/bottom;
  its coded pixel count can therefore slightly exceed the processing limit.
- GIF delay zero or missing is normalised to 100 ms; nonzero delays are retained.
  Browser players may impose their own minimum playback delay.
- GIF disposal 2 uses a transparent background when the animation declares
  transparency; otherwise it uses the global logical background colour.
  User-input-controlled GIF timing and reserved disposal values are rejected.

These are practical limits for local browser processing, not a guarantee that
every low-memory device can process the largest allowed file. Only encoded
output and a small number of decoded frames are retained; the full raw clip is
never stored as an array of frames.

## Architecture

| Location                                  | Responsibility                                                       |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `engine/src/engine.cpp`                   | Resampling, palette construction, colour matching and dithering      |
| `PaletteTrainer` in the public C++ header | Persistent, bounded histogram for clip-wide colour analysis          |
| `engine/src/wasm_api.cpp`                 | C-compatible bridge and explicit result/trainer ownership            |
| `web/src/engine.worker.ts`                | Existing still-image processing worker                               |
| `web/src/animation/gif.ts`                | GIF metadata, one-frame decompression and logical-screen compositing |
| `web/src/animation/video.ts`              | MP4/WebM profile checks and sampled frame decoding                   |
| `web/src/animation/processor.ts`          | Wasm buffers, palette training and frame conversion                  |
| `web/src/animation/encode.ts`             | GIF indexing and video container/codec output                        |
| `web/src/animation/animation.worker.ts`   | Two-pass processing job and progress reporting                       |
| `web/src/animation/AnimationEditor.tsx`   | Animation settings, previews, cancellation and download              |

The codecs and containers are handled by gifuct-js, gifenc and Mediabunny.
The image transformation remains in the project's C++ engine. Animation code
is loaded when its editor is opened, keeping it separate from the initial
still-image interface.

For adaptive mode, pass one samples each downsampled frame into a bounded C++
histogram, weighted by its display duration. Pass two processes each frame using
the finished palette and feeds it to an encoder with backpressure. Fixed palettes
skip the analysis pass. Read [docs/ANIMATION.md](docs/ANIMATION.md) for details.

## Build, test and deploy

```bash
npm ci
source ~/tools/emsdk/emsdk_env.sh
npx playwright install chromium
npm test
```

The complete suite builds the native CLI and Wasm/web release, checks reference
images and package installation, then runs browser tests. Individual commands:

```bash
npm run build
npm run build:native
npm run test:native
npm run test:wasm
npm run test:sdk
npm run test:cli
npm run test:references
npm run test:animation
npm run pack:sdk
npm run test:package
npm run test:e2e
```

`test:e2e` rebuilds the UI every time, serves it on a dedicated port (4197) and
refuses to reuse an existing process. A stale Wasm build fails early with the
rebuild command. Use `TEST_BASE_URL` only when intentionally testing an external
site; that mode skips local build/server management.

Frozen references are never updated during tests. Maintainers can review and
regenerate them explicitly using `npm run references:update` after a native
build. Significant RGB differences are limited to 0.5% of pixels (ignoring
channel deltas up to 2), with exact alpha. See tests/reference/README.md.

```bash
npm run build
npm run preview
```

For the existing Lightsail/Nginx/Cloudflare host and `crtvd.vaell.dev`, follow
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Build locally and publish only `dist/`;
no application server/database is required for CRTVD. Nginx examples, atomic
release upload and rollback instructions are included.

If hosting under a URL path instead of a dedicated subdomain, set the same
`BASE_PATH=/CRTVD/` when building and previewing. Subdomain deployment uses `/`.

## Licence and references

Project source uses the [MIT licence](LICENSE). Dependencies retain their own
licences; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

- [Algorithm notes](docs/ALGORITHMS.md)
- [Animation implementation and limitations](docs/ANIMATION.md)
- [The effect of CRTs on pixel art](https://datagubbe.se/crt/)
- [GM Shaders: CRT](https://mini.gmshaders.com/p/gm-shaders-mini-crt)
- [Touring the TRS-80's capabilities](https://bumbershootsoft.wordpress.com/2022/01/28/touring-the-trs-80s-capabilities/)

The output prepares low-resolution assets for later use with a CRT display
renderer. This version does not claim hardware-accurate CRT emulation.
