import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { createProcessor, VERSION } from '@vael2196/crtvd';

const runs = Number(process.env.BENCH_RUNS || 15),
  warmup = Number(process.env.BENCH_WARMUP || 3);
if (
  !Number.isInteger(runs) ||
  runs < 3 ||
  runs > 1000 ||
  !Number.isInteger(warmup) ||
  warmup < 0 ||
  warmup > 100
)
  throw new Error('Invalid benchmark run counts');
const fixture = 'benchmarks/fixtures/scene.png',
  bytes = readFileSync(fixture),
  image = PNG.sync.read(bytes);
const native = spawnSync(
  `build/native-release/crtvd-bench${process.platform === 'win32' ? '.exe' : ''}`,
  [fixture, String(runs), String(warmup)],
  { encoding: 'utf8' },
);
if (native.status !== 0)
  throw new Error(native.stderr || 'Build the native CLI/benchmark with npm run build:native');
const nativeReport = JSON.parse(native.stdout);
const processor = await createProcessor({
  wasmBinary: readFileSync('packages/core/lib/wasm/crtvd.wasm'),
});
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    runsMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
const cases = [];
try {
  for (const entry of nativeReport.cases) {
    const engine = [],
      total = [];
    for (let i = -warmup; i < runs; i++) {
      const result = processor.processFrame(
        { data: image.data, width: image.width, height: image.height },
        {
          width: entry.width,
          height: entry.height,
          colours: entry.colours,
          dither: entry.dither,
          strength: 0.65,
          resample: 'area',
          palette: 'adaptive',
        },
      );
      if (i >= 0) {
        engine.push(result.processingMs);
        total.push(result.totalMs);
      }
    }
    cases.push({
      width: entry.width,
      height: entry.height,
      colours: entry.colours,
      dither: entry.dither,
      native: entry,
      wasmEngine: stats(engine),
      wasmApi: stats(total),
    });
  }
} finally {
  processor.dispose();
}
let quota = 'unavailable';
try {
  quota = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim();
} catch {}
const report = {
  version: VERSION,
  measuredAt: new Date().toISOString(),
  environment: {
    platform: os.platform(),
    arch: os.arch(),
    node: process.version,
    cpu: os.cpus()[0]?.model,
    availableParallelism: os.availableParallelism(),
    cpuQuota: quota,
    nativeCompiler: nativeReport.compiler,
    wasmBuild: JSON.parse(readFileSync('web/public/wasm/build.json')),
  },
  fixture: {
    file: fixture,
    width: image.width,
    height: image.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  runs,
  warmup,
  metrics: {
    native: 'C++ process() call, allocation included; input decoding and PNG writing excluded',
    wasmEngine: 'Wasm C API call only, allocation included; JS copies excluded',
    wasmApi: 'Whole synchronous SDK call, including validation and JS/Wasm copies',
  },
  cases,
};
mkdirSync('benchmarks/results', { recursive: true });
writeFileSync('benchmarks/results/baseline.json', JSON.stringify(report, null, 2) + '\n');
writeFileSync('web/public/benchmarks.json', JSON.stringify(report, null, 2) + '\n');
const rows = cases
  .map(
    (c) =>
      `| ${c.width} × ${c.height} | ${c.colours} | ${c.dither} | ${c.native.medianMs.toFixed(2)} / ${c.native.p95Ms.toFixed(2)} | ${c.wasmEngine.medianMs.toFixed(2)} / ${c.wasmEngine.p95Ms.toFixed(2)} | ${c.wasmApi.medianMs.toFixed(2)} / ${c.wasmApi.p95Ms.toFixed(2)} |`,
  )
  .join('\n');
writeFileSync(
  'benchmarks/RESULTS.md',
  `# Measured baseline — CRTVD ${VERSION}\n\nMeasured at ${report.measuredAt}. Input: ${image.width} × ${image.height} RGBA8, adaptive palette, area resampling.\n${warmup} warm-up calls followed by ${runs} measured calls per case. Values are median / p95 in milliseconds.\n\n| Output | Colours | Dither | Native engine | Wasm engine | Wasm SDK total |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\nEnvironment: ${report.environment.cpu}, ${report.environment.platform}/${report.environment.arch}, Node ${process.version}, GCC/Clang ${nativeReport.compiler}. CPU quota: ${quota}.\nNative flags: -std=c++20 -O3 -DNDEBUG. Wasm flags: -O3, SIMD disabled.\n\nNative and Wasm engine times include processing allocations but exclude image decoding/encoding. SDK total additionally includes JS validation and input/output copies. This is a shared, virtualised execution environment; results are not representative of every browser or device, and are not a real-time video guarantee. The Wasm run uses Node's runtime, not browser rendering.\n\nRaw runs, source fingerprint, fixture SHA-256 and toolchain metadata: [results/baseline.json](results/baseline.json). Reproduce with \`npm run build:native\`, \`npm run build\`, then \`npm run bench\`. The report is also copied into the static site at \`/benchmarks.html\` and \`/benchmarks.json\`.\n`,
);
const escape = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const htmlRows = cases
  .map(
    (c) =>
      `<tr><td>${c.width} × ${c.height}</td><td>${c.colours}</td><td>${c.dither}</td><td>${c.native.medianMs.toFixed(2)}</td><td>${c.wasmEngine.medianMs.toFixed(2)}</td><td>${c.wasmApi.medianMs.toFixed(2)}</td></tr>`,
  )
  .join('');
writeFileSync(
  'web/public/benchmarks.html',
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRTVD benchmark results</title><style>body{font:14px Tahoma,Verdana,sans-serif;background:#171747;color:#111;padding:20px}main{max-width:1000px;margin:auto;background:#d4d0c8;border:3px outset white;padding:20px}h1{background:#000080;color:white;font:24px 'Courier New',monospace;padding:12px}table{border-collapse:collapse;background:white;width:100%;font-size:13px}td,th{border:1px solid #777;padding:8px;text-align:left}th{background:#e9e9ff}p{line-height:1.6}.scroll{overflow:auto}a{color:#0000ee}</style><main><h1>CRTVD ${VERSION} / measured baseline</h1><p>${escape(report.measuredAt)} · ${warmup} warm-ups, ${runs} measured runs · ${image.width} × ${image.height} input</p><div class="scroll"><table><tr><th>Output</th><th>Colours</th><th>Dither</th><th>Native median ms</th><th>Wasm engine median ms</th><th>SDK total median ms</th></tr>${htmlRows}</table></div><p>${escape(report.environment.cpu)} · ${escape(report.environment.platform)}/${escape(report.environment.arch)} · ${escape(process.version)} · native compiler ${escape(nativeReport.compiler)}.</p><p>Engine times include allocations and exclude file codecs. SDK total includes validation and JS/Wasm copies. Wasm was measured in Node, not browser rendering. Shared virtualised CPU results are a reproducible baseline, not a performance promise for another device.</p><p><a href="benchmarks.json">Raw runs, p95 and environment metadata</a> · <a href="./">Back to CRTVD</a></p></main></html>\n`,
);
console.log(rows);
