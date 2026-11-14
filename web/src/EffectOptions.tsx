import { useId } from 'react';
import { DEFAULT_ASCII } from './ascii';
import type { AsciiOptions } from './ascii';
import type { Effects } from './effects';
import { BLUR_LIMIT, rgbKey } from './filters';
import { hex, triplets } from './palettes';

export function EffectOptions({
  effects,
  palette,
  update,
}: {
  effects: Effects;
  palette: number[];
  update(value: Partial<Effects>): void;
}) {
  const note = useId();
  const ascii = effects.ascii;
  const updateAscii = (value: Partial<AsciiOptions>) =>
    update({ ascii: { ...DEFAULT_ASCII, ...ascii, ...value } });
  const available = [...new Set(triplets(palette).map(([r, g, b]) => rgbKey(r, g, b)))];
  const remembered = effects.effectColours.filter((colour) => !available.includes(colour));
  const selection = new Set(effects.effectColours);
  return (
    <>
      <fieldset className="effect-block">
        <legend>Blur</legend>
        <label className="advanced-field">
          Blur type
          <select
            value={effects.blur}
            onChange={(e) => {
              const blur = e.target.value as Effects['blur'];
              update({ blur, blurRadius: Math.min(effects.blurRadius, BLUR_LIMIT[blur] || 12) });
            }}
          >
            <option value="off">Off</option>
            <option value="gaussian">Gaussian · soft focus</option>
            <option value="median">Median · remove specks</option>
            <option value="bilateral">Bilateral · keep edges</option>
          </select>
        </label>
        {effects.blur !== 'off' && (
          <label className="advanced-field">
            Blur radius{' '}
            <span className="advanced-value" aria-hidden="true">
              {effects.blurRadius} px
            </span>
            <input
              type="range"
              min={1}
              max={BLUR_LIMIT[effects.blur]}
              value={effects.blurRadius}
              onChange={(e) => update({ blurRadius: +e.target.value })}
            />
          </label>
        )}
        {effects.blur === 'bilateral' && (
          <label className="advanced-field">
            Edge softness{' '}
            <span className="advanced-value" aria-hidden="true">
              {Math.round(effects.blurRange * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(effects.blurRange * 100)}
              onChange={(e) => update({ blurRange: +e.target.value / 100 })}
            />
          </label>
        )}
      </fieldset>
      <fieldset className="effect-block">
        <legend>Colour targeting</legend>
        <label className="advanced-field">
          Apply effects to
          <select
            value={effects.colourScope}
            aria-describedby={note}
            onChange={(e) => update({ colourScope: e.target.value as Effects['colourScope'] })}
          >
            <option value="all">All colours</option>
            <option value="except">All except selected (lock)</option>
            <option value="only">Only selected</option>
          </select>
        </label>
        <p id={note} className="field-note">
          Targets blur, fringes and ASCII using exact colours from the converted palette. Blending
          still controls where the original shows.
        </p>
        {effects.colourScope !== 'all' && (
          <>
            <div role="group" className="effect-swatches" aria-label="Colours for effect targeting">
              {[...available, ...remembered].map((value) => {
                const colour = hex([value >> 16, (value >> 8) & 255, value & 255]);
                const checked = selection.has(value);
                return (
                  <button
                    key={value}
                    type="button"
                    className="effect-swatch"
                    aria-label={colour}
                    aria-pressed={checked}
                    title={
                      remembered.includes(value) ? `${colour} · not in current palette` : colour
                    }
                    onClick={() =>
                      update({
                        effectColours: checked
                          ? effects.effectColours.filter((c) => c !== value)
                          : [...effects.effectColours, value],
                      })
                    }
                  >
                    <span style={{ background: colour }} aria-hidden="true" />
                    {checked && <b aria-hidden="true">✓</b>}
                  </button>
                );
              })}
            </div>
            {!available.length && (
              <p className="field-note">Preview or convert to see the current palette.</p>
            )}
            {remembered.length > 0 && (
              <p className="field-note">
                Selections absent from this palette are remembered by hex.
              </p>
            )}
            {effects.colourScope === 'only' && !selection.size && (
              <p className="field-note">Select a swatch to enable effects on it.</p>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!selection.size}
              onClick={() => update({ effectColours: [] })}
            >
              Clear colour selection
            </button>
          </>
        )}
      </fieldset>
      <fieldset className="effect-block">
        <legend>ASCII art</legend>
        <label className="effect-checkbox">
          <input
            type="checkbox"
            checked={!!ascii}
            onChange={(e) => update({ ascii: e.target.checked ? { ...DEFAULT_ASCII } : undefined })}
          />
          Render as ASCII
        </label>
        {ascii && (
          <>
            <label className="advanced-field">
              ASCII symbols
              <select
                value={ascii.symbols}
                onChange={(e) =>
                  updateAscii({ symbols: e.target.value as AsciiOptions['symbols'] })
                }
              >
                <option value="classic">Classic · .:-=+*#%@</option>
                <option value="terminal">Terminal · .01#@</option>
                <option value="sparse">Sparse · .:+=#</option>
                <option value="custom">Custom characters</option>
              </select>
            </label>
            {ascii.symbols === 'custom' && (
              <label className="advanced-field">
                Custom ASCII characters
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  value={ascii.custom}
                  onChange={(e) => updateAscii({ custom: e.target.value.replace(/[^ -~]/g, '') })}
                />
                <small className="field-note">
                  Order symbols from lightest coverage to heaviest. A space draws no ink.
                </small>
              </label>
            )}
            <label className="advanced-field">
              ASCII cell size{' '}
              <span className="advanced-value" aria-hidden="true">
                {ascii.cell} px
              </span>
              <input
                type="range"
                min={4}
                max={32}
                value={ascii.cell}
                onChange={(e) => updateAscii({ cell: +e.target.value })}
              />
              <small className="field-note">Smaller cells fit more characters.</small>
            </label>
            <label className="advanced-field">
              ASCII glyph size{' '}
              <span className="advanced-value" aria-hidden="true">
                {Math.round(ascii.size * 100)}%
              </span>
              <input
                type="range"
                min={35}
                max={100}
                value={Math.round(ascii.size * 100)}
                onChange={(e) => updateAscii({ size: +e.target.value / 100 })}
              />
            </label>
            <label className="advanced-field">
              ASCII tonal contrast{' '}
              <span className="advanced-value" aria-hidden="true">
                {Math.round(ascii.contrast * 100)}%
              </span>
              <input
                type="range"
                min={50}
                max={250}
                value={Math.round(ascii.contrast * 100)}
                onChange={(e) => updateAscii({ contrast: +e.target.value / 100 })}
              />
            </label>
            <label className="advanced-field">
              ASCII ink
              <select
                value={ascii.ink}
                onChange={(e) => updateAscii({ ink: e.target.value as AsciiOptions['ink'] })}
              >
                <option value="palette">Converted colours</option>
                <option value="white">White terminal</option>
              </select>
            </label>
            <label className="effect-checkbox">
              <input
                type="checkbox"
                checked={ascii.invert}
                onChange={(e) => updateAscii({ invert: e.target.checked })}
              />
              Invert symbol ramp
            </label>
          </>
        )}
      </fieldset>
    </>
  );
}
