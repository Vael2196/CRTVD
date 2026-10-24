import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { DEFAULT_SETTINGS } from '../types';
import type { Settings } from '../types';
import type { AnimationOptions, AnimationResponse, ClipInfo } from './types';
import { animationSize, LIMITS } from './limits';
import { useAnimationWorker } from './useAnimationWorker';
import { makeDemoGif } from './demo';

type Converted = Extract<AnimationResponse, { type: 'done' }> & { url: string; filename: string };
const defaults: AnimationOptions = {
  settings: { ...DEFAULT_SETTINGS },
  format: 'gif',
  fps: 20,
  matte: '#101714',
};

export function AnimationEditor() {
  const [source, setSource] = useState<{ file: File; info: ClipInfo; url: string } | null>(null);
  const [options, setOptions] = useState<AnimationOptions>(defaults);
  const [output, setOutput] = useState<Converted | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);
  const { run, stop, busy, progress } = useAnimationWorker();
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  useEffect(
    () => () => {
      if (output) URL.revokeObjectURL(output.url);
    },
    [output],
  );
  const edit = (update: Partial<AnimationOptions>) => {
    setOptions((o) => ({ ...o, ...update }));
    setOutput(null);
    setError('');
  };
  const setting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setOptions((o) => ({ ...o, settings: { ...o.settings, [key]: value } }));
    setOutput(null);
    setError('');
  };
  const load = async (file?: File) => {
    if (!file) return;
    const id = ++loadId.current;
    setLoading(true);
    setError('');
    setOutput(null);
    try {
      const answer = await run({ type: 'probe', file });
      if (answer.type === 'info' && id === loadId.current)
        setSource({ file, info: answer.info, url: URL.createObjectURL(file) });
    } catch (e) {
      if (id === loadId.current && !(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Could not read this clip.');
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
    void load(e.dataTransfer.files[0]);
  };
  const convert = async () => {
    if (!source) return;
    setOutput(null);
    setError('');
    try {
      const answer = await run({ type: 'convert', file: source.file, options });
      if (answer.type !== 'done') return;
      const url = URL.createObjectURL(new Blob([answer.bytes], { type: answer.mime }));
      const stem = source.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
      setOutput({
        ...answer,
        url,
        filename: `${stem}-crtvd-${answer.width}x${answer.height}.${answer.extension}`,
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Conversion failed.');
    }
  };
  const cancel = () => {
    loadId.current++;
    stop();
    setLoading(false);
    setError('');
  };
  const size = source
    ? animationSize(source.info, options.settings.targetWidth)
    : { width: 160, height: 107 };
  const maxWidth = source
    ? animationSize(source.info, LIMITS.outputWidth).width
    : LIMITS.outputWidth;
  const s = options.settings;
  const percent = progress ? Math.min(100, Math.round(progress.fraction * 100)) : 0;

  return (
    <main className="animation-editor">
      <section className="intro">
        <div>
          <p className="eyebrow">SAME CHARACTER. A LITTLE MOVEMENT.</p>
          <h1>
            Give every frame
            <br />
            <em>a shared sense of colour.</em>
          </h1>
          <p className="intro-copy">
            Convert GIFs and short videos into palette-limited animations.
            <br />
            One palette across the clip. Everything stays on your device.
          </p>
        </div>
        <div className="edition">
          <span className="edition-dots" aria-hidden="true">
            ▪ ▪ ▪
          </span>
          <span>THE ANIMATION EDITION</span>
          <strong>02 / IN MOTION</strong>
        </div>
      </section>
      <section className="workspace" aria-label="Animation editor">
        <aside className="controls animation-controls">
          <div className="panel-heading">
            <h2>The controls</h2>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setOptions({ ...defaults, settings: { ...DEFAULT_SETTINGS } });
                setOutput(null);
                setError('');
              }}
            >
              Reset
            </button>
          </div>
          <button
            className="upload-card"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop}
          >
            <strong>{loading ? 'Reading your clip…' : 'Drop a GIF or short video'}</strong>
            <span>or browse your files</span>
            <small>GIF · MP4/H.264 · WebM/VP8 or VP9</small>
          </button>
          <input
            ref={input}
            type="file"
            className="visually-hidden"
            aria-label="Upload animation"
            accept="image/gif,video/mp4,video/webm,.gif,.mp4,.webm"
            onChange={onFile}
          />
          <button
            className="sample-button"
            onClick={() =>
              void load(new File([makeDemoGif()], 'moving-dusk.gif', { type: 'image/gif' }))
            }
          >
            Try the moving landscape <span aria-hidden="true">↗</span>
          </button>
          <fieldset disabled={busy} className="animation-fields">
            <div className="control-group">
              <div className="label-row">
                <label htmlFor="animation-width">Output width</label>
                <span className="value-chip">
                  {size.width} × {size.height}
                </span>
              </div>
              <input
                id="animation-width"
                type="range"
                min="1"
                max={maxWidth}
                value={size.width}
                onChange={(e) => setting('targetWidth', +e.target.value)}
              />
              <div className="quick-sizes">
                {[80, 160, 320].map((n) => (
                  <button
                    key={n}
                    className={size.width === n ? 'selected' : ''}
                    disabled={n > maxWidth}
                    onClick={() => setting('targetWidth', n)}
                  >
                    {n}px
                  </button>
                ))}
              </div>
            </div>
            <div className="control-group">
              <label htmlFor="animation-resample">Downsampling</label>
              <select
                id="animation-resample"
                value={s.resample}
                onChange={(e) => setting('resample', e.target.value as Settings['resample'])}
              >
                <option value="area">Area average · anti-aliased</option>
                <option value="nearest">Nearest neighbour · crisp</option>
              </select>
            </div>
            <div className="control-group">
              <label htmlFor="animation-palette">Colour palette</label>
              <select
                id="animation-palette"
                value={s.palette}
                onChange={(e) => setting('palette', e.target.value as Settings['palette'])}
              >
                <option value="adaptive">Adaptive · shared across clip</option>
                <option value="monochrome">Paper & ink · black and white</option>
                <option value="handheld">Pocket green · 4 colours</option>
                <option value="cga">Electric four · cyan and magenta</option>
              </select>
              {s.palette === 'adaptive' && (
                <div className="colour-control">
                  <label htmlFor="animation-colours">Maximum colours</label>
                  <select
                    id="animation-colours"
                    value={s.colours}
                    onChange={(e) => setting('colours', +e.target.value)}
                  >
                    {[2, 4, 8, 16, 32, 64, 128, 256].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="field-note">
                Adaptive mode learns one palette from the full clip, weighted by frame duration.
              </p>
            </div>
            <div className="control-group">
              <label htmlFor="animation-dither">Dithering</label>
              <select
                id="animation-dither"
                value={s.dither}
                onChange={(e) => setting('dither', e.target.value as Settings['dither'])}
              >
                <option value="none">None · clean colour regions</option>
                <option value="bayer">Ordered · Bayer 4 × 4</option>
                <option value="floyd">Diffusion · Floyd–Steinberg</option>
              </select>
              <div className="strength-control">
                <div className="label-row">
                  <label htmlFor="animation-strength">Dither strength</label>
                  <span>{Math.round(s.strength * 100)}%</span>
                </div>
                <input
                  id="animation-strength"
                  type="range"
                  min="0"
                  max="100"
                  disabled={s.dither === 'none'}
                  value={Math.round(s.strength * 100)}
                  onChange={(e) => setting('strength', +e.target.value / 100)}
                />
              </div>
              <p className="field-note">
                Ordered patterns stay anchored to the output grid. Motion can still reveal shimmer.
              </p>
            </div>
            <div className="control-group">
              <label htmlFor="animation-format">Output format</label>
              <select
                id="animation-format"
                value={options.format}
                onChange={(e) => edit({ format: e.target.value as AnimationOptions['format'] })}
              >
                <option value="gif">GIF · exact palette, 1-bit alpha</option>
                <option value="webm">WebM · VP8, silent</option>
                <option value="mp4">MP4 · H.264, silent</option>
              </select>
              <p className="field-note">
                Video support is checked on conversion. GIF remains available without WebCodecs.
              </p>
            </div>
            <div className="control-group">
              <label htmlFor="animation-fps">Video input sampling rate</label>
              <select
                id="animation-fps"
                value={options.fps}
                disabled={source?.info.kind === 'gif'}
                onChange={(e) => edit({ fps: +e.target.value })}
              >
                {[10, 15, 20, 24, 25, 30].map((n) => (
                  <option key={n} value={n}>
                    {n} fps
                  </option>
                ))}
              </select>
              <p className="field-note">
                GIF inputs keep their original frame delays. Video inputs are sampled on a constant
                timeline.
              </p>
            </div>
            {options.format !== 'gif' && (
              <div className="control-group">
                <label htmlFor="animation-matte">Video background</label>
                <input
                  id="animation-matte"
                  type="color"
                  value={options.matte}
                  onChange={(e) => edit({ matte: e.target.value })}
                />
                <p className="field-note">
                  Video output is opaque. Transparent GIF pixels are composited onto this colour.
                </p>
              </div>
            )}
          </fieldset>
        </aside>
        <div className="preview-panel animation-preview">
          <div className="preview-toolbar">
            <strong>In motion</strong>
            <span className="engine-status" role="status">
              <i />
              {busy
                ? loading
                  ? 'Reading clip'
                  : progress?.phase === 'palette'
                    ? 'Learning the palette'
                    : 'Converting frames'
                : output
                  ? 'Conversion complete'
                  : source
                    ? 'Ready to convert'
                    : 'Choose a clip'}
            </span>
          </div>
          <div className="animation-previews">
            <figure>
              <figcaption>ORIGINAL</figcaption>
              {source ? (
                source.info.kind === 'gif' ? (
                  <img src={source.url} alt="Original animation" />
                ) : (
                  <video
                    src={source.url}
                    aria-label="Original video"
                    controls
                    muted
                    playsInline
                    loop
                  />
                )
              ) : (
                <div className="animation-placeholder">
                  Start with a GIF or short video,
                  <br />
                  or try the moving landscape.
                </div>
              )}
            </figure>
            <figure>
              <figcaption>CONVERTED</figcaption>
              {output ? (
                output.extension === 'gif' ? (
                  <img src={output.url} alt="Converted animation" />
                ) : (
                  <video
                    src={output.url}
                    aria-label="Converted video"
                    controls
                    muted
                    playsInline
                    loop
                  />
                )
              ) : (
                <div className="animation-placeholder">
                  {busy && !loading
                    ? 'Preparing your frames…'
                    : 'Your converted animation appears here.'}
                </div>
              )}
            </figure>
          </div>
          {source && (
            <div className="image-meta">
              <span className="filename" title={source.file.name}>
                {source.file.name}
              </span>
              <span>
                {source.info.width} × {source.info.height} · {source.info.duration.toFixed(2)} s ·{' '}
                {source.info.frameCount
                  ? `${source.info.frameCount} frames`
                  : source.info.codec.toUpperCase()}
              </span>
            </div>
          )}
          <div className="animation-notes">
            <p>Up to 30 seconds · 900 frames · 512 px output width</p>
            <p>
              Video exports are silent.{' '}
              {source?.info.hasAudio
                ? 'This input contains audio, which will be omitted.'
                : 'Audio is omitted from exported assets.'}
            </p>
            <p>
              GIF keeps exact palette colours; lossy video encoding may introduce nearby colours.
              Previews play independently.
            </p>
            {options.format === 'gif' && (
              <p>
                GIF uses binary transparency (alpha below 50% becomes transparent). A 256-colour
                request uses 255 RGB colours plus one transparent entry.
              </p>
            )}
            {options.format === 'mp4' && (
              <p>
                MP4 pads odd output dimensions by one black pixel on the right or bottom to satisfy
                H.264 encoders.
              </p>
            )}
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          {busy && (
            <div className="animation-progress">
              <label htmlFor="conversion-progress">
                {loading
                  ? 'Reading the clip'
                  : `${progress?.phase === 'palette' ? 'Learning palette' : 'Encoding frames'} · ${percent}%${progress ? ` · frame ${progress.frame}` : ''}`}
              </label>
              <progress id="conversion-progress" value={percent} max="100" />
            </div>
          )}
          {output && (
            <div className="palette-panel">
              <div className="palette-heading">
                <span>SHARED CLIP PALETTE</span>
                <span>{output.palette.length / 3} RGB colours</span>
              </div>
              <div className="swatches">
                {Array.from({ length: output.palette.length / 3 }, (_, i) => {
                  const rgb = output.palette.slice(i * 3, i * 3 + 3);
                  const colour = `rgb(${rgb.join(',')})`;
                  return <span key={i} style={{ background: colour }} title={colour} />;
                })}
              </div>
              <p>
                {output.width} × {output.height} · {output.frames} frames ·{' '}
                {output.duration.toFixed(2)} s · {(output.bytes.byteLength / 1024).toFixed(1)} KiB
              </p>
            </div>
          )}
          <div className="export-bar animation-actions">
            <div>
              <strong>{busy ? 'One frame at a time.' : 'Ready when you are.'}</strong>
              <span>
                {source
                  ? `${size.width} × ${size.height} processing resolution`
                  : 'GIF: up to 16 MiB · video: up to 64 MiB'}
              </span>
            </div>
            <div className="export-actions">
              {busy ? (
                <button className="secondary-button" onClick={cancel}>
                  Cancel
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={!source}
                  onClick={() => void convert()}
                >
                  Convert animation<span aria-hidden="true">→</span>
                </button>
              )}
              {output && !busy && (
                <a className="primary-button" href={output.url} download={output.filename}>
                  Download {output.extension.toUpperCase()}
                  <span aria-hidden="true">↓</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
      <footer>
        <span>CRTVD / CRT Visual Downscaler</span>
        <span className="footer-badges">
          <b>LOCAL FILES</b>
          <b>WASM INSIDE</b>
          <b>ONE PALETTE</b>
        </span>
        <span>
          <a href={`${import.meta.env.BASE_URL}benchmarks.html`}>Benchmarks</a> · v0.3
        </span>
      </footer>
    </main>
  );
}
