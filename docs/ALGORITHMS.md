# The still-image pipeline

Input RGBA8 → downsample → construct palette → quantise with optional dither →
output RGBA8. RGB bytes are sRGB-encoded; alpha is straight (unassociated).

## 1. Downsampling

**Nearest neighbour** samples the source pixel under each output pixel's centre.
It is useful for already-crisp artwork, but can miss fine features and alias
photographs.

**Area averaging** integrates the rectangular source footprint of each output
pixel. Partial overlaps receive fractional weights, so reducing a 3-pixel row
to 2 pixels does not incorrectly give every source pixel the same weight.

Before averaging, sRGB channels are decoded into linear light. Averaging an
opaque black pixel and an opaque white pixel therefore produces about 188 in
sRGB, rather than 128. The latter would average encoded values instead of light.

Colours are multiplied by alpha during integration, and unassociated again
afterwards. For example, opaque red beside invisible blue becomes half-visible
red, not purple. Alpha itself is averaged by coverage.

This is a conventional box/area filter. It is not an edge-alignment or
content-aware pixel-art algorithm. Such approaches can be compared against
this baseline later.

## 2. Adaptive palette construction

The engine samples at most 65,536 downsampled pixels at deterministic evenly
spaced indices. Samples are placed into 32 × 32 × 32 bins using their sRGB
channels. Within each occupied bin, it accumulates linear RGB weighted by alpha.
Invisible samples do not affect the palette.

Each occupied bin becomes a representative colour with a population weight.
The engine converts these representatives into Oklab, then repeatedly:

1. Chooses a splittable box by its longest Oklab extent × square root of weight.
2. Sorts that box along its longest Oklab axis.
3. Splits near its weighted median, ensuring neither side is empty.
4. Stops at the colour limit or when nothing remains to split.

Each final box produces an alpha-weighted mean in linear RGB, encoded back to
sRGB8. Duplicate representatives are removed. This is a practical median-cut
variant, not a globally optimal palette solver. Sampling and binning can lose
rare colours; further splitting cannot recover detail that was already merged
into a bin.

Fixed palettes bypass this stage. Their colour counts are fixed independently
of the adaptive colour-count control.

## 3. Colour matching

Each output pixel is converted to Oklab and assigned the closest palette entry
using squared Euclidean distance. Oklab is a perceptual approximation: small
distances aim to reflect small perceived differences better than raw RGB
distance. It does not guarantee the artistically best match.

The reference transform is by Björn Ottosson:
https://bottosson.github.io/posts/oklab/

Palette entries are preconverted once per job. Matching is a direct O(pixels ×
palette size) search, intentionally straightforward for this baseline. No SIMD,
GPU processing, spatial search structure, or lookup-table approximation is used.

## 4. Ordered dithering

The 4 × 4 Bayer matrix supplies a repeating threshold. Before nearest-palette
selection, the engine offsets the pixel's Oklab lightness by that threshold,
scaled by the user strength and palette size. This produces a stable spatial
pattern and is easy to inspect.

The threshold amplitude is a heuristic. This is lightness-perturbation ordered
dithering, not optimal pairwise palette mixing. Every visible output RGB value
still comes from the chosen palette; the effect never blends arbitrary colours
into the finished output.

## 5. Error diffusion

Floyd–Steinberg assigns a pixel to a palette colour, then spreads its linear-RGB
quantisation error to unprocessed neighbours with weights 7/16, 3/16, 5/16,
and 1/16. Odd-numbered rows run in reverse and mirror these neighbours
(serpentine scanning), reducing a directional bias.

Only two error rows are stored. Errors are scaled by user strength and source
alpha; they are not sent into fully transparent neighbours. At image boundaries,
missing neighbours are omitted and weights are not renormalised.

Matching happens in Oklab while error is propagated in linear RGB. Consequently,
ordered and diffusion methods are different approximations, not identical
brightness-preserving renderers. Dither strength controls threshold/error
amplitude, not opacity of a second image layer.

## 6. Transparency and export

The alpha channel is preserved after downsampling. Fully transparent output
pixels are canonicalised to transparent black. RGB quantisation does not
quantise alpha, so “16 colours” means at most 16 visible RGB triplets, not 16
possible RGBA combinations.

The browser exports RGBA PNGs. Optional 2×/4× export uses integer nearest-neighbour
enlargement; it changes file dimensions, not the underlying conversion quality.

## 7. Reproducibility and measurement

Sampling and splitting have no random seed or clock-dependent behaviour. The
same build, input and options are deterministic. Floating-point/libm differences
between native and Wasm toolchains can alter ties; byte-identical output across
all compilers is not promised. Tests use exact values for simple analytic
fixtures and invariants/tolerances for general behaviour.

The UI's elapsed time covers the worker engine invocation and extraction of its
result. It is a convenience indicator, not a benchmark. Publish comparisons
only with recorded source/output sizes, palettes, dither modes, browser, device,
build settings, and multiple warm runs.

## Reading

- Emscripten's build workflow: https://emscripten.org/docs/compiling/Building-Projects.html
- Modularised Wasm loaders: https://emscripten.org/docs/compiling/Modularized-Output.html
- Oklab: https://bottosson.github.io/posts/oklab/
- CRT display discussion: https://datagubbe.se/crt/
- CRT shader stages: https://mini.gmshaders.com/p/gm-shaders-mini-crt
- TRS-80 display constraints: https://bumbershootsoft.wordpress.com/2022/01/28/touring-the-trs-80s-capabilities/
- Pixel Projection: https://www.pixelprojection.com/
