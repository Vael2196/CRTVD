import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { decodeImage, demoImage, downloadPng, maxOutputWidth, outputSize } from './media';
import { DEFAULT_SETTINGS } from './types';
import type { Settings, SourceImage } from './types';
import { useEngine } from './useEngine';
import { lazy, Suspense } from 'react';
const AnimationEditor = lazy(() =>
  import('./animation/AnimationEditor').then((m) => ({ default: m.AnimationEditor })),
);

const PRESETS: { name: string; detail: string; settings: Partial<Settings> }[] = [
  {
    name: 'Soft dusk',
    detail: '16 colours · ordered',
    settings: {
      palette: 'adaptive',
      colours: 16,
      dither: 'bayer',
      strength: 0.65,
      resample: 'area',
    },
  },
  {
    name: 'Paper & ink',
    detail: '2 colours · diffusion',
    settings: { palette: 'monochrome', dither: 'floyd', strength: 1, resample: 'area' },
  },
  {
    name: 'Pocket green',
    detail: '4 colours · ordered',
    settings: { palette: 'handheld', dither: 'bayer', strength: 0.85, resample: 'area' },
  },
  {
    name: 'Electric four',
    detail: '4 colours · diffusion',
    settings: { palette: 'cga', dither: 'floyd', strength: 0.8, resample: 'area' },
  },
];

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V3m0 0L7 8m5-5 5 5M4 15v5h16v-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StillImageEditor() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<'split' | 'output' | 'original'>('split');
  const [split, setSplit] = useState(50);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const nativeCanvas = useRef<HTMLCanvasElement | null>(null);
  const loadId = useRef(0);
  const { ready, processing, error, result } = useEngine(source, settings);

  useEffect(() => {
    setSource(demoImage());
  }, []);
  useEffect(() => {
    if (!source || !originalCanvas.current) return;
    const canvas = originalCanvas.current;
    // Keep preview-sized copies to avoid scaling a huge source on every paint.
    canvas.width = Math.min(1440, source.width);
    canvas.height = Math.max(1, Math.round((canvas.width * source.height) / source.width));
    canvas.getContext('2d')!.drawImage(source.canvas, 0, 0, canvas.width, canvas.height);
  }, [source]);
  useEffect(() => {
    if (!result || !previewCanvas.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    const pixels = new Uint8ClampedArray(result.rgba);
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
    nativeCanvas.current = canvas;
    const preview = previewCanvas.current;
    preview.width = result.width;
    preview.height = result.height;
    preview
      .getContext('2d')!
      .putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
  }, [result]);

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const load = async (file?: File) => {
    if (!file) return;
    const id = ++loadId.current;
    setLoading(true);
    setLoadError('');
    try {
      const decoded = await decodeImage(file);
      if (id === loadId.current) setSource(decoded);
    } catch (e) {
      if (id === loadId.current)
        setLoadError(e instanceof Error ? e.message : 'Could not read this image.');
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    void load(e.target.files?.[0]);
    e.target.value = '';
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void load(e.dataTransfer.files[0]);
  };
  const useSample = () => {
    loadId.current++;
    setLoading(false);
    setLoadError('');
    setSource(demoImage());
  };
  const size = source ? outputSize(source, settings.targetWidth) : { width: 160, height: 107 };
  const palette: string[] = [];
  if (result)
    for (let i = 0; i < result.palette.length; i += 3)
      palette.push(
        '#' +
          result.palette
            .slice(i, i + 3)
            .map((x) => x.toString(16).padStart(2, '0'))
            .join(''),
      );
  const exportImage = async () => {
    if (!nativeCanvas.current || !result) return;
    setExporting(true);
    setLoadError('');
    const stem = (source?.name.replace(/\.[^.]+$/, '') || 'image').replace(/[^a-zA-Z0-9_-]+/g, '-');
    try {
      await downloadPng(
        nativeCanvas.current,
        `${stem}-crtvd-${result.width * scale}x${result.height * scale}.png`,
        scale,
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };
  const activePreset = PRESETS.find((p) =>
    Object.entries(p.settings).every(([key, value]) => settings[key as keyof Settings] === value),
  );
  const status = error
    ? 'Engine unavailable'
    : !ready
      ? 'Starting image engine'
      : loading
        ? 'Opening image'
        : processing
          ? 'Updating image'
          : 'Ready';

  return (
    <main>
      <section className="intro">
        <div>
          <p className="eyebrow">LESS RESOLUTION. MORE CHARACTER.</p>
          <h1>
            A little less detail.
            <br />
            <em>A whole different feeling.</em>
          </h1>
          <p className="intro-copy">
            Small resolutions, considered palettes, a touch of dither.
            <br className="desktop-break" /> Make something worth looking at, one pixel at a time.
          </p>
        </div>
        <div className="edition">
          <span className="edition-dots" aria-hidden="true">
            ▪ ▪ ▪
          </span>
          <span>THE STILL IMAGE EDITION</span>
          <strong>01 / CONVERT</strong>
        </div>
      </section>
      <section className="workspace" aria-label="Image editor">
        <aside className="controls">
          <div className="panel-heading">
            <h2>The controls</h2>
            <button className="text-button" onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>
              Reset
            </button>
          </div>
          <button
            className={`upload-card ${dragging ? 'dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <span className="upload-symbol">
              <UploadIcon />
            </span>
            <strong>{loading ? 'Opening image…' : 'Drop an image here'}</strong>
            <span>or browse your files</span>
            <small>PNG, JPG, WebP, AVIF · up to 32 MB</small>
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            aria-label="Upload image"
            onChange={onFile}
          />
          <button className="sample-button" onClick={useSample}>
            Try the built-in landscape <span aria-hidden="true">↗</span>
          </button>
          <div className="control-group">
            <div className="label-row">
              <label htmlFor="resolution">Output width</label>
              <span className="value-chip">
                {size.width} × {size.height}
              </span>
            </div>
            <input
              id="resolution"
              type="range"
              min="1"
              max={source ? maxOutputWidth(source) : 1024}
              value={size.width}
              onChange={(e) => change('targetWidth', +e.target.value)}
            />
            <div className="range-caption">
              <span>More abstract</span>
              <span>More detail</span>
            </div>
            <div className="quick-sizes">
              {[80, 160, 320].map((width) => (
                <button
                  key={width}
                  className={size.width === width ? 'selected' : ''}
                  disabled={!!source && width > maxOutputWidth(source)}
                  onClick={() => change('targetWidth', width)}
                >
                  {width}px
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label htmlFor="resampling">Downsampling</label>
            <select
              id="resampling"
              value={settings.resample}
              onChange={(e) => change('resample', e.target.value as Settings['resample'])}
            >
              <option value="area">Area average · anti-aliased</option>
              <option value="nearest">Nearest neighbour · crisp</option>
            </select>
            <p className="field-note">
              Area averaging softens detail before reducing it. Nearest neighbour samples a single
              pixel.
            </p>
          </div>
          <div className="control-group">
            <label htmlFor="palette">Colour palette</label>
            <select
              id="palette"
              value={settings.palette}
              onChange={(e) => change('palette', e.target.value as Settings['palette'])}
            >
              <option value="adaptive">Adaptive · from your image</option>
              <option value="monochrome">Paper & ink · black and white</option>
              <option value="handheld">Pocket green · 4 colours</option>
              <option value="cga">Electric four · cyan and magenta</option>
            </select>
            {settings.palette === 'adaptive' && (
              <div className="colour-control">
                <label htmlFor="colours">Maximum colours</label>
                <select
                  id="colours"
                  value={settings.colours}
                  onChange={(e) => change('colours', +e.target.value)}
                >
                  {[2, 4, 8, 16, 24, 32, 64, 128, 256].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="control-group">
            <label htmlFor="dither">Dithering</label>
            <select
              id="dither"
              value={settings.dither}
              onChange={(e) => change('dither', e.target.value as Settings['dither'])}
            >
              <option value="none">None · clean colour regions</option>
              <option value="bayer">Ordered · Bayer 4 × 4</option>
              <option value="floyd">Diffusion · Floyd–Steinberg</option>
            </select>
            <div className={`strength-control ${settings.dither === 'none' ? 'muted' : ''}`}>
              <div className="label-row">
                <label htmlFor="strength">Dither strength</label>
                <span>{Math.round(settings.strength * 100)}%</span>
              </div>
              <input
                id="strength"
                type="range"
                min="0"
                max="100"
                disabled={settings.dither === 'none'}
                value={Math.round(settings.strength * 100)}
                onChange={(e) => change('strength', +e.target.value / 100)}
              />
            </div>
          </div>
        </aside>
        <div className="preview-panel">
          <div className="preview-toolbar">
            <div className="view-tabs" role="group" aria-label="Preview mode">
              {(['split', 'output', 'original'] as const).map((mode) => (
                <button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>
                  {mode === 'split' ? 'Compare' : mode === 'output' ? 'Converted' : 'Original'}
                </button>
              ))}
            </div>
            <span className={`engine-status ${processing ? 'working' : ''}`} role="status">
              <i />
              {status}
            </span>
          </div>
          <div
            className={`preview-stage ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <div
              className="image-frame"
              style={{
                aspectRatio: source ? `${source.width} / ${source.height}` : '3 / 2',
                maxWidth: source
                  ? `min(100%, ${(600 * source.width) / source.height}px)`
                  : undefined,
              }}
              aria-label="Image comparison"
            >
              <canvas
                ref={originalCanvas}
                className="original-image"
                style={{
                  visibility: view === 'output' ? 'hidden' : 'visible',
                  clipPath: view === 'split' ? `inset(0 ${100 - split}% 0 0)` : undefined,
                }}
                aria-label="Original image preview"
              />
              <canvas
                ref={previewCanvas}
                className="converted-image"
                style={{
                  visibility: view === 'original' || !result ? 'hidden' : 'visible',
                  clipPath: view === 'split' ? `inset(0 0 0 ${split}%)` : undefined,
                }}
                aria-label="Converted image preview"
              />
              {view === 'split' && result && (
                <>
                  <div className="split-line" style={{ left: `${split}%` }}>
                    <span aria-hidden="true">↔</span>
                  </div>
                  <input
                    className="split-slider"
                    aria-label="Comparison position"
                    type="range"
                    min="0"
                    max="100"
                    value={split}
                    onChange={(e) => setSplit(+e.target.value)}
                  />
                  <span className="image-tag original-tag">ORIGINAL</span>
                  <span className="image-tag output-tag">CONVERTED</span>
                </>
              )}
              {!result && (
                <div className="image-loading">
                  <span />
                  {error ? 'Engine unavailable' : 'Preparing your pixels…'}
                </div>
              )}
            </div>
          </div>
          <div className="image-meta">
            <span className="filename" title={source?.name}>
              {source?.name || 'Choose an image'}
            </span>
            <span>
              {source ? `${source.width} × ${source.height}` : ''}
              <span className="meta-arrow">→</span>
              {size.width} × {size.height}
            </span>
          </div>
          {(loadError || error) && (
            <div className="error-message" role="alert">
              {loadError || error}
            </div>
          )}
          <div className="palette-panel">
            <div className="palette-heading">
              <span>YOUR PALETTE</span>
              <span>{palette.length ? `${palette.length} colours` : '—'}</span>
            </div>
            <div className="swatches">
              {palette.map((colour, i) => (
                <span
                  key={`${i}-${colour}`}
                  style={{ background: colour }}
                  title={colour}
                  aria-label={colour}
                />
              ))}
            </div>
            <p>RGB colours only; transparency is preserved separately.</p>
          </div>
          <div className="export-bar">
            <div>
              <strong>Keep the pixels.</strong>
              <span>
                {result
                  ? `${result.width * scale} × ${result.height * scale} PNG`
                  : 'Your converted image will appear here.'}
                {result && <small> · {Math.round(result.milliseconds)} ms processing</small>}
              </span>
            </div>
            <div className="export-actions">
              <label className="visually-hidden" htmlFor="export-scale">
                Export scale
              </label>
              <select id="export-scale" value={scale} onChange={(e) => setScale(+e.target.value)}>
                {[1, 2, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Native size' : `${n}× pixel scale`}
                  </option>
                ))}
              </select>
              <button
                className="primary-button"
                disabled={!result || processing || loading || exporting || !!error}
                onClick={() => void exportImage()}
              >
                {exporting ? 'Exporting…' : 'Export PNG'}
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="preset-section" aria-label="Presets">
        <div>
          <p className="eyebrow">A PLACE TO START</p>
          <h2>Four ways to see it.</h2>
        </div>
        <div className="preset-grid">
          {PRESETS.map((preset, index) => (
            <button
              key={preset.name}
              className={`preset-card preset-${index} ${activePreset?.name === preset.name ? 'active' : ''}`}
              aria-pressed={activePreset?.name === preset.name}
              onClick={() => setSettings((s) => ({ ...s, ...preset.settings }))}
            >
              <span className="preset-art" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="preset-title">
                {preset.name}
                <span aria-hidden="true">↗</span>
              </span>
              <small>{preset.detail}</small>
            </button>
          ))}
        </div>
      </section>
      <footer>
        <span>
          CRTVD <span className="footer-dot">/</span> CRT Visual Downscaler
        </span>
        <span className="footer-badges">
          <b>LOCAL FILES</b>
          <b>WASM INSIDE</b>
          <b>PNG / GIF / VIDEO</b>
        </span>
        <span>
          <a href={`${import.meta.env.BASE_URL}benchmarks.html`}>Benchmarks</a> · v0.3
        </span>
      </footer>
    </main>
  );
}

export function App() {
  const [mode, setMode] = useState<'still' | 'animation'>('still');
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="CRTVD home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>CRTVD</strong>
          <span className="brand-name">CRT Visual Downscaler</span>
        </a>
        <div className="media-mode-switch" role="group" aria-label="Editor mode">
          <button aria-pressed={mode === 'still'} onClick={() => setMode('still')}>
            Still image
          </button>
          <button aria-pressed={mode === 'animation'} onClick={() => setMode('animation')}>
            Animation
          </button>
        </div>
        <span className="local-badge">
          <span /> Your images stay on your device
        </span>
      </header>
      {mode === 'still' ? (
        <StillImageEditor />
      ) : (
        <Suspense
          fallback={
            <main>
              <p>Opening animation editor…</p>
            </main>
          }
        >
          <AnimationEditor />
        </Suspense>
      )}
    </div>
  );
}
