# Animation processing, explained

An animation needs both image processing and a timeline. Frame colours must
stay coherent, while each picture must appear at the right time.

## Why a palette shared across the clip matters

For a still image, an adaptive palette is chosen from one picture. Choosing a
fresh palette for every frame can make stationary objects change colour when
other objects enter the scene.

CRTVD's `PaletteTrainer` is a C++ class: an object whose histogram persists
while frames are examined. It owns a fixed-size vector with 32 × 32 × 32 bins.
Each bin stores accumulated linear RGB and a weight, requiring about 1 MiB.

For every frame, the trainer:

1. Downsamples through the same C++ resampler used for the final image.
2. Samples up to 4,096 pixels at deterministic, evenly spaced indices.
3. Adds each visible sample to a bin, weighted by alpha × display duration,
   divided by the number of samples.

A frame visible for one second therefore contributes more than one visible for
a tenth of a second. `finish()` runs the existing Oklab-based weighted median-cut
partitioning on the combined histogram. That palette is passed back into every
subsequent frame conversion.

The custom-palette argument is optional, so the existing still-image API keeps
its behaviour. The Wasm bridge adds trainer create/add/finish/free functions and
a process function accepting explicit RGB palette bytes. The worker is
responsible for freeing these opaque C++ objects after copying the results.

This reduces palette flicker; it does **not** eliminate motion-induced dither
shimmer. Bayer thresholds are anchored to output coordinates, and diffusion
starts fresh for each frame. There is no optical flow, motion compensation or
cross-frame error buffer in this release.

## Two passes without storing the decoded clip

Adaptive conversion opens the source, visits its frames to train the palette,
then decodes the source again to process and encode them. Fixed palettes skip
the training pass.

Only the compressed input, current frame, small decoder/canvas state, histogram
and growing encoded output need to remain live. The implementation does not
collect all decoded frames in a JavaScript array.

Video writing awaits `CanvasSource.add()`, respecting encoder backpressure.
Cancellation terminates the dedicated worker, releasing its Wasm instance and
browser decoder/encoder resources. Each job gets a new worker.

## GIFs are patches on a logical screen

gifuct-js decompresses one image patch at a time. Our compositor keeps the full
logical screen and applies the previous frame's disposal before the next patch:

- 0/1: retain the current screen.
- 2: restore the previous patch rectangle to the logical background.
- 3: restore the screen saved before the previous patch was drawn.

Transparent patch pixels leave the underlying screen unchanged. Local colour
tables and interlacing are interpreted during decompression. With declared
transparency, the logical background is transparent; otherwise the global
background colour is used.

The compositor's frame buffer is borrowed by each iteration. Matting a GIF for
video export copies that buffer first, preserving the compositor state needed
for the next frame. This is tested explicitly.

Zero/missing GIF delays are normalised to 100 ms. Nonzero delays and NETSCAPE /
ANIMEXTS repeat fields are retained. Without a repeat extension, exported GIFs
play once. Video-to-GIF exports loop by default.

Every exported GIF frame is a complete output image with disposal 2. One global
palette is written in the first frame. Index zero is reserved for transparency;
visible colours use indices 1–255. Quantised RGB bytes map directly to those
indices, so the GIF encoder does not quantise the image a second time.

## Video containers and codecs

MP4/WebM are containers: they package compressed frames and timing information.
H.264, VP8 and VP9 are codecs: they define the compressed video bitstream.
Recognising a container does not imply the browser has its codec.

Mediabunny handles MP4/WebM reading and writing. WebCodecs supplies browser
decoders/encoders. The application explicitly limits input to MP4/H.264 and
WebM/VP8 or VP9, and output to WebM/VP8 or MP4/H.264. Support is checked using
the actual track and output dimensions before the expensive palette pass.

Video inputs are sampled at timestamps `start + index / fps`, with the final
sample shortened to the actual clip end. Rotation and display aspect metadata
are applied by the canvas sink; coded and display dimensions are both checked.
Negative presentation times are not exported. Outputs begin at zero.

GIF-to-video keeps the GIF's variable frame durations. For any GIF output, frame
boundaries are rounded to centiseconds from absolute timestamps, rather than
rounding every duration independently. This avoids a drift such as thirty
33.33 ms frames becoming a 900 ms clip.

Audio is deliberately omitted from this visual-asset release, and the UI says
so before processing. HDR, HEVC, AV1, MOV and variable-resolution streams are not
supported. Lossy video output cannot guarantee exact palette RGB values after
decoding, even though the pre-encoding engine result obeys the palette.

## Transparency

PNG and the internal RGBA buffers preserve alpha. GIF can represent only one
transparent palette index, so export thresholds alpha at 128. Video export is
opaque: transparent pixels are composited onto the chosen matte in linear light
before training and quantisation. H.264 output pads odd dimensions with a black
right/bottom border; the image itself is not stretched.

## Tests

The animation unit tests use independently constructed GIF fixtures for partial
offsets, disposal 2/3, transparency, local palettes, interlacing and timing. They
also round-trip the GIF writer and check duration rounding and non-mutating
linear-light matting.

Native C++ and Wasm tests cover shared palettes, duration weighting, validation
and the new bridge. Browser tests run real GIF jobs, generate a WebM fixture,
decode/encode video, and round-trip H.264 output back into GIF when the browser
offers H.264. They also cover cancellation, limit errors and the still-image
workflow. Codec-dependent tests state a skip reason when the codec is unavailable.

## Primary references

- GIF89a specification: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
- gifuct-js source: https://github.com/matt-way/gifuct-js
- gifenc source: https://github.com/mattdesl/gifenc
- Mediabunny: https://mediabunny.dev/guide/introduction
- WebCodecs: https://www.w3.org/TR/webcodecs/
