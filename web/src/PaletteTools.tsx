import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import {
  decodePalette,
  encodePalette,
  fromHex,
  hex,
  hsvToRgb,
  rgbToHsv,
  suggestColours,
  triplets,
} from './palettes';
import type { RGB } from './palettes';
import { recommended, retro } from './presets';
import type { Preset } from './presets';
import type { Settings } from './types';

function Popup({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="panel-heading">
        <h2 id={heading}>{title}</h2>
        <button type="button" className="text-button" onClick={close} aria-label="Close dialog">
          Close
        </button>
      </div>
      <div className="editor-dialog-content">{children}</div>
    </dialog>
  );
}

function ColourPicker({
  initial,
  palette,
  close,
  apply,
}: {
  initial: RGB;
  palette: RGB[];
  close(): void;
  apply(colour: RGB): void;
}) {
  const [hsv, setHsv] = useState<RGB>(() => rgbToHsv(initial));
  const [input, setInput] = useState(() => hex(initial));
  const colour = fromHex(input) ?? hsvToRgb(hsv);
  const suggestions = useMemo(() => suggestColours(initial, palette), [initial, palette]);
  const setColour = (value: RGB) => {
    const next = rgbToHsv(value);
    setHsv(([h]) => [next[1] ? next[0] : h, next[1], next[2]]);
    setInput(hex(value));
  };
  const update = (next: RGB) => {
    setHsv(next);
    setInput(hex(hsvToRgb(next)));
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    update([
      ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360,
      Math.min(1, Math.hypot(x, y)),
      hsv[2],
    ]);
  };
  const angle = (hsv[0] * Math.PI) / 180;
  return (
    <Popup title="Change colour" close={close}>
      <div className="colour-picker-layout">
        <div
          className="hue-wheel"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            point(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e);
          }}
        >
          <span className="wheel-shade" style={{ opacity: 1 - hsv[2] }} />
          <span
            className="wheel-cursor"
            style={{
              left: `${50 + 50 * Math.sin(angle) * hsv[1]}%`,
              top: `${50 - 50 * Math.cos(angle) * hsv[1]}%`,
            }}
          />
        </div>
        <div className="picker-fields">
          <label>
            Hex{' '}
            <input
              value={input}
              maxLength={7}
              spellCheck={false}
              aria-invalid={!fromHex(input)}
              onChange={(e) => {
                setInput(e.target.value);
                const parsed = fromHex(e.target.value);
                if (parsed) setHsv(rgbToHsv(parsed));
              }}
            />
          </label>
          <div className="rgb-fields">
            {['Red', 'Green', 'Blue'].map((name, i) => (
              <label key={name}>
                {name}
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={colour[i]}
                  onChange={(e) => {
                    if (!Number.isFinite(e.target.valueAsNumber)) return;
                    const next: RGB = [...colour];
                    next[i] = Math.max(0, Math.min(255, Math.round(e.target.valueAsNumber)));
                    setColour(next);
                  }}
                />
              </label>
            ))}
          </div>
          {['Hue', 'Saturation', 'Brightness'].map((name, i) => (
            <label key={name} className="colour-scale">
              <span>
                {name}{' '}
                <span aria-hidden="true">
                  {Math.round(hsv[i] * (i ? 100 : 1))}
                  {i ? '%' : '°'}
                </span>
              </span>
              <input
                type="range"
                min="0"
                max={i ? 100 : 359}
                value={Math.round(hsv[i] * (i ? 100 : 1))}
                onChange={(e) => {
                  const next: RGB = [...hsv];
                  next[i] = +e.target.value / (i ? 100 : 1);
                  update(next);
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="colour-comparison">
        <span style={{ background: hex(initial) }} />
        {hex(initial)} → <span style={{ background: hex(colour) }} />
        {hex(colour)}
      </div>
      <h3>Suggested colours</h3>
      {(
        [
          ['Nearby in your palette', suggestions.nearby],
          ['Pairs well', suggestions.paired],
          ['Contrasting accents', suggestions.contrast],
        ] as const
      ).map(
        ([label, colours]) =>
          colours.length > 0 && (
            <div className="suggestion-row" key={label}>
              <span>{label}</span>
              <div className="swatches">
                {colours.map((rgb, i) => (
                  <button
                    type="button"
                    key={i}
                    className="editable-swatch"
                    style={{ background: hex(rgb) }}
                    title={hex(rgb)}
                    aria-label={`Use ${hex(rgb)}`}
                    onClick={() => setColour(rgb)}
                  />
                ))}
              </div>
            </div>
          ),
      )}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!fromHex(input)}
          onClick={() => apply(colour)}
        >
          Apply colour
        </button>
      </div>
    </Popup>
  );
}

function PaletteCode({
  colours,
  max,
  close,
  apply,
}: {
  colours: number[];
  max: number;
  close(): void;
  apply(colours: number[]): void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const exportField = useRef<HTMLTextAreaElement>(null);
  const exported = colours.length ? encodePalette(colours) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setStatus('Palette code copied.');
    } catch {
      exportField.current?.focus();
      exportField.current?.select();
      setStatus('Code selected. Copy it using your browser or keyboard.');
    }
  };
  return (
    <Popup title="Import / export palette" close={close}>
      <p className="field-note">
        The code contains RGB colours only. It can be used on another image or clip.
      </p>
      {exported && (
        <>
          <label className="code-field">
            Export code
            <textarea ref={exportField} rows={2} value={exported} readOnly spellCheck={false} />
          </label>
          <button type="button" className="secondary-button" onClick={() => void copy()}>
            Copy palette code
          </button>
          {status && <p role="status">{status}</p>}
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            apply(decodePalette(code, max));
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Invalid palette code.');
          }
        }}
      >
        <label className="code-field">
          Import code
          <textarea
            rows={3}
            value={code}
            maxLength={1600}
            spellCheck={false}
            placeholder="CRTVD1:…"
            onChange={(e) => {
              setCode(e.target.value);
              setError('');
            }}
          />
        </label>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" className="primary-button" disabled={!code.trim()}>
            Apply palette
          </button>
        </div>
      </form>
    </Popup>
  );
}

export function PalettePanel({
  colours,
  altered,
  disabled,
  max = 256,
  onEdit,
  onDefault,
  onImport,
}: {
  colours: number[];
  altered: boolean;
  disabled?: boolean;
  max?: number;
  onEdit(index: number, rgb: RGB): void;
  onDefault(): void;
  onImport(colours: number[]): void;
}) {
  const [popup, setPopup] = useState<number | 'code' | null>(null);
  const palette = useMemo(() => triplets(colours), [colours]);
  const close = () => setPopup(null);
  return (
    <div className="palette-panel">
      <div className="palette-heading">
        <span>YOUR PALETTE</span>
        <span>{palette.length ? `${palette.length} colours` : '—'}</span>
      </div>
      <div className="swatches">
        {palette.map((rgb, i) => (
          <span className="swatch-slot" key={i}>
            <button
              type="button"
              className="editable-swatch"
              disabled={disabled}
              style={{ background: hex(rgb) }}
              title={hex(rgb)}
              aria-label={`Edit colour ${i + 1}: ${hex(rgb)}`}
              onClick={() => setPopup(i)}
            />
          </span>
        ))}
      </div>
      <div className="palette-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => setPopup('code')}
        >
          Import / export palette
        </button>
        {altered && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={onDefault}
          >
            Default palette
          </button>
        )}
      </div>
      <p className="field-note">
        {palette.length
          ? 'Choose a swatch to change it. Transparency is separate.'
          : 'A converted preview reveals its editable swatches.'}
      </p>
      {popup === 'code' && (
        <PaletteCode
          colours={colours}
          max={max}
          close={close}
          apply={(value) => {
            close();
            onImport(value);
          }}
        />
      )}
      {typeof popup === 'number' && palette[popup] && (
        <ColourPicker
          initial={palette[popup]}
          palette={palette}
          close={close}
          apply={(rgb) => {
            close();
            onEdit(popup, rgb);
          }}
        />
      )}
    </div>
  );
}

export function PresetGallery({
  settings,
  disabled,
  apply,
}: {
  settings: Settings;
  disabled?: boolean;
  apply(preset: Preset): void;
}) {
  const [more, setMore] = useState(false);
  const id = useId();
  const render = (preset: Preset, index: number) => {
    const isActive =
      !settings.paletteEdit &&
      !settings.importedPalette &&
      (preset.settings.customPalette
        ? settings.customPalette === preset.settings.customPalette
        : !settings.customPalette &&
          Object.entries(preset.settings).every(
            ([key, value]) => settings[key as keyof Settings] === value,
          ));
    return (
      <button
        type="button"
        key={preset.name}
        className={`preset-card preset-${index % 4} ${isActive ? 'active' : ''}`}
        aria-pressed={isActive}
        disabled={disabled}
        onClick={() => apply(preset)}
      >
        <span
          className={preset.settings.customPalette ? 'preset-art palette-strip' : 'preset-art'}
          aria-hidden="true"
        >
          {preset.settings.customPalette ? (
            triplets(preset.settings.customPalette).map((rgb, i) => (
              <i key={i} style={{ background: hex(rgb) }} />
            ))
          ) : (
            <>
              <i />
              <i />
              <i />
            </>
          )}
        </span>
        <span className="preset-title">{preset.name}</span>
        <small>{preset.detail}</small>
      </button>
    );
  };
  return (
    <section className="preset-section" aria-label="Presets">
      <div>
        <p className="eyebrow">A PLACE TO START</p>
        <h2>Recommended palettes</h2>
      </div>
      <div className="preset-gallery">
        <div className="preset-grid">{recommended.map(render)}</div>
        <button
          type="button"
          className="secondary-button more-palettes"
          aria-expanded={more}
          aria-controls={id}
          onClick={() => setMore(!more)}
        >
          {more ? 'Hide retro console palettes' : 'Show 18 retro console palettes'}
        </button>
        <div id={id} hidden={!more}>
          {more && (
            <>
              <p>
                Retro console palettes from{' '}
                <a
                  href="https://colorany.com/color-palettes/retro-console-color-palettes/"
                  target="_blank"
                  rel="noreferrer"
                >
                  ColorAny
                </a>
                .
              </p>
              <div className="preset-grid">{retro.map(render)}</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
