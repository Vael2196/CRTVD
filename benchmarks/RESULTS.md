# Measured baseline — CRTVD 0.3.0

Measured at 2026-10-24T10:53:23.352Z. Input: 960 × 640 RGBA8, adaptive palette, area resampling.
3 warm-up calls followed by 15 measured calls per case. Values are median / p95 in milliseconds.

| Output | Colours | Dither | Native engine | Wasm engine | Wasm SDK total |
| --- | --- | --- | --- | --- | --- |
| 160 × 107 | 16 | bayer | 8.37 / 10.27 | 10.31 / 13.62 | 10.69 / 13.93 |
| 320 × 213 | 32 | floyd | 22.88 / 26.13 | 27.74 / 42.86 | 28.26 / 43.19 |
| 512 × 341 | 64 | none | 51.77 / 59.17 | 59.54 / 62.35 | 60.33 / 63.27 |

Environment: INTEL(R) XEON(R) PLATINUM 8573C, linux/x64, Node v24.22.1, GCC/Clang 13.3.0. CPU quota: 800000 100000.
Native flags: -std=c++20 -O3 -DNDEBUG. Wasm flags: -O3, SIMD disabled.

Native and Wasm engine times include processing allocations but exclude image decoding/encoding. SDK total additionally includes JS validation and input/output copies. This is a shared, virtualised execution environment; results are not representative of every browser or device, and are not a real-time video guarantee. The Wasm run uses Node's runtime, not browser rendering.

Raw runs, source fingerprint, fixture SHA-256 and toolchain metadata: [results/baseline.json](results/baseline.json). Reproduce with `npm run build:native`, `npm run build`, then `npm run bench`. The report is also copied into the static site at `/benchmarks.html` and `/benchmarks.json`.
