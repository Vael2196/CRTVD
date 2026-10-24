<h1 align="center">CRT Visual Downscaler</h1>

<p align="center">
  <strong>Small palettes. Big pixels.</strong><br />
  Turn photos, GIFs and short videos into low-resolution, limited-palette artwork.
</p>

<p align="center">
  <a href="https://crtvd.vaell.dev"><strong>Open CRTVD</strong></a>
  &nbsp;·&nbsp;
  <a href="#what-you-can-make">Features</a>
  &nbsp;·&nbsp;
  <a href="#one-engine-three-ways-to-use-it">Engine and API</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Vael2196/CRTVD/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/Vael2196/CRTVD/actions/workflows/check.yml"><img src="https://github.com/Vael2196/CRTVD/actions/workflows/check.yml/badge.svg?branch=main" alt="Build and test" /></a>
  <img src="https://img.shields.io/badge/C%2B%2B-20-00599c?style=flat" alt="C++20" />
  <img src="https://img.shields.io/badge/WebAssembly-654ff0?style=flat" alt="WebAssembly" />
  <img src="https://img.shields.io/badge/React-TypeScript-3178c6?style=flat" alt="React and TypeScript" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/Licence-MIT-4c7a52?style=flat" alt="MIT licence" /></a>
</p>

CRTVD is a media-processing tool for artwork that belongs at smaller resolutions:
dithered photographs, restrained colour palettes and animations with a consistent set of colours.
An early-web interface lets you experiment in the browser; a reusable package and command-line
tool bring the same processing into other projects.

The transformation runs on your device. Your selected files are processed locally, with no
media upload or account required.

## What you can make

- **Still images with deliberate limits.** Reduce resolution, choose an adaptive palette of
  2–256 colours, or use monochrome, handheld green and CGA-inspired palettes.
- **Two approaches to downsampling.** Linear-light area averaging filters detail before reduction;
  nearest neighbour keeps individual samples crisp.
- **Dithered colour transitions.** Choose 4 × 4 Bayer patterns, serpentine Floyd–Steinberg error
  diffusion, or no dithering, with adjustable strength.
- **Animations with one palette per clip.** Adaptive mode learns a palette from the whole animation,
  weighted by each frame's display duration, then reuses it for every frame.
- **Useful exports.** Save transparent PNGs at their processing size or an integer pixel scale.
  Export animations as GIF, WebM or MP4 where the browser supports the required codecs.
- **An interface with an earlier-web feel.** Bevelled panels, blue title bars, a tiled navy
  background and live previews, with progress reporting and cancellation for animation jobs.

CRTVD prepares assets for retro-inspired games, interfaces and later CRT rendering. Its current
effects are resolution reduction, palette quantisation and dithering; scanlines, phosphor masks,
screen curvature and hardware-accurate CRT simulation are outside this release.

## Try it

1. Open [CRTVD](https://crtvd.vaell.dev) and choose **Still image** or **Animation**.
2. Use the built-in sample or select a supported file from your device.
3. Set the output width, palette and dithering. For still images, compare the original and result
   in the split preview.
4. Download the PNG, or select an animation format and run the conversion.

For a quick starting point, try **Soft dusk** for an adaptive palette, **Paper & ink** for
monochrome, or **Pocket green** for a handheld-inspired still image.

## Formats and current scope

| Workflow             | Input                                                      | Output                                                |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Browser still images | PNG, JPEG, WebP, AVIF, subject to browser decoding support | RGBA PNG, with optional integer enlargement           |
| Browser animation    | GIF; MP4 with H.264/AVC; WebM with VP8 or VP9              | GIF; WebM with VP8; MP4 with H.264/AVC                |
| Native CLI           | PNG, JPEG                                                  | RGBA PNG, with optional palette and JSON report files |

Animation jobs are limited to **30 seconds and 900 frames**, with at most **512 pixels in output
width** and **262,144 processing pixels per frame**. GIF inputs are limited to **16 MiB**, video
inputs to **64 MiB**, and encoded outputs to **64 MiB**.

GIF inputs retain their frame timing. Video inputs are sampled at the selected 10–30 fps.
GIF export uses binary transparency; video exports composite onto the selected background and
**omit audio**. Lossy video encoding can introduce colours beyond the engine's palette.
MP4 export pads odd dimensions to even dimensions.

Video support is checked at runtime and varies by browser and operating system. HEVC, AV1,
MOV and HDR are outside the supported profiles. See the [animation notes](docs/ANIMATION.md)
for frame compositing, timing, size limits and transparency behaviour.

## One engine, three ways to use it

The processing engine is written in C++20 and works with RGBA pixel buffers independently of
the interface, image codecs and file paths. Emscripten compiles it to WebAssembly for browser
use; a native build uses the same source.

| Entry point                              | What it provides                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Web editor](web/src)                    | React and TypeScript controls, local decoding, worker orchestration, previews and exports                    |
| [TypeScript/Wasm package](packages/core) | Framework-independent frame processing, shared palette training, typed options and explicit resource cleanup |
| [Native CLI](native)                     | PNG/JPEG conversion, custom palette input, palette export and machine-readable reports                       |

The package is named `@vael2196/crtvd` and can be built as an installable npm tarball.
Registry publication is separate from the repository's release build.

### Engineering decisions

- **Keep transformation logic in one place.** Both browser editors use the TypeScript package,
  while native and Wasm builds share the C++ engine.
- **Treat light and transparency explicitly.** Area resampling averages in linear light with
  alpha-weighted colours. Palette matching uses Oklab; transparent pixels do not contaminate
  neighbouring colours during filtering.
- **Analyse animations before encoding.** A bounded histogram learns the clip's palette in a
  first pass. The second pass processes and encodes frames incrementally, without retaining
  the entire decoded clip.
- **Keep processing off the interface thread.** Web Workers host the synchronous Wasm calls.
  Still-image requests discard obsolete results; cancellation terminates animation work.
- **Make ownership part of the API.** Output buffers are caller-owned copies. Processor and
  trainer objects expose disposal, and builds verify the source fingerprint and loader/binary
  hashes before packaging Wasm assets.

Read the [algorithm notes](docs/ALGORITHMS.md), [animation design](docs/ANIMATION.md) and
[public API](docs/API.md) for implementation details and trade-offs.

## Run locally

Requirements: **Node.js 22.12+** (24 recommended), **Python 3**, Git and
**Emscripten 6.0.13**. A native C++20 compiler is also needed for the CLI and full test suite.

Install Emscripten using its [official SDK instructions](https://emscripten.org/docs/getting_started/downloads.html).
For a new SDK installation, select the project's pinned version:

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/tools/emsdk
cd ~/tools/emsdk
./emsdk install 6.0.13
./emsdk activate 6.0.13
source ./emsdk_env.sh
```

Clone and start CRTVD:

```bash
git clone https://github.com/Vael2196/CRTVD.git
cd CRTVD

source ~/tools/emsdk/emsdk_env.sh
npm ci
npm run build:wasm
npm run dev
```

Open the local URL printed by Vite. Source `emsdk_env.sh` again when building from a new terminal;
use your actual SDK path if it differs.

For a production build and local preview:

```bash
npm run build
npm run preview
```

The deployable site is in `dist/`. A dedicated subdomain uses the default `BASE_PATH=/`;
for hosting under a path, build and preview with the same `BASE_PATH` value.

### Use the native CLI or package

After installing dependencies:

```bash
npm run build:native
./build/native-release/crtvd input.jpg output.png --width 160 --colours 16 --dither bayer
```

Native compilation does not require Emscripten. A [CMake build](CMakeLists.txt) is also available.
GIF and video codecs belong to the web application; the native CLI processes still images.

To build the TypeScript/Wasm package:

```bash
npm run build
npm run pack:sdk
```

Install the resulting `release/vael2196-crtvd-0.3.0.tgz` in another project with `npm install`.
See the [package README](packages/core/README.md) for browser, worker and Node examples, and the
[API reference](docs/API.md) for options, limits, asset loading and memory ownership.

## Quality and measurement

[GitHub Actions](https://github.com/Vael2196/CRTVD/actions/workflows/check.yml) builds the native,
Wasm and web targets, runs the complete suite, and uploads a `crtvd-release` artifact.

| Checks                       | What they exercise                                                              |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Native and Wasm engine tests | Resampling, colour reduction, dithering, alpha and bridge validation            |
| SDK and CLI tests            | Input validation, buffer ownership, disposal, file I/O and overwrite protection |
| Frozen reference images      | Native and Wasm output compared against reviewed PNG baselines                  |
| Animation tests              | Shared palettes, GIF compositing and disposal, timing, encoding and limits      |
| Playwright browser tests     | Real worker/Wasm conversion, exports, cancellation and desktop/mobile layouts   |
| Package and build checks     | Installation outside the repository and fresh UI builds before browser tests    |

Run the suite with the SDK active and a native C++20 compiler available:

```bash
npx playwright install chromium
npm test
```

Reference images are not regenerated during tests. The [reference-image notes](tests/reference/README.md)
describe the tolerance and review process. Browser tests currently target Chromium, including mobile
emulation; they do not establish compatibility with every browser or physical device.

The [benchmark report](benchmarks/RESULTS.md) includes raw runs, warm-ups, median/p95 timings,
fixture hashes and toolchain metadata. It measures native processing and Wasm under Node on a
shared Linux host, excluding codec I/O and browser rendering. It is a reproducible baseline,
not a cross-device frame-rate promise.

Reproduce it after building the native and Wasm targets with `npm run bench`.
The deployed [benchmark page](https://crtvd.vaell.dev/benchmarks.html) presents the same baseline.

## Deployment

The live application is hosted at [crtvd.vaell.dev](https://crtvd.vaell.dev) on AWS Lightsail,
with Nginx serving static files behind Cloudflare. Processing runs in the visitor's browser.

The repository includes [HTTP and HTTPS Nginx examples](deploy) and a
[static-release upload script](scripts/deploy-static.sh). GitHub Actions also produces the built
site for artifact-based deployment. Server-specific operational notes are maintained separately
from this public overview.

## Feedback and contributions

Found a bug or have an improvement in mind? [Open an issue](https://github.com/Vael2196/CRTVD/issues)
with your browser and operating system, processing settings, and the expected and actual result.
Include a small file that reproduces the problem if you are comfortable sharing it.

For changes to processing algorithms, include tests and compare the affected reference images.
Discuss larger features in an issue before opening a pull request.

## Author and licence

Built by [Vadim Filyakin](https://github.com/Vael2196).

Project source is available under the [MIT licence](LICENSE). Dependencies retain their own
licences; see [third-party notices](THIRD_PARTY_NOTICES.md). The [algorithm notes](docs/ALGORITHMS.md#reading)
credit the colour-space and CRT references that inform the project.
