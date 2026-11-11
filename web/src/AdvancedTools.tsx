import { useId, useState } from 'react';
import type { PointerEvent } from 'react';
import { DEFAULT_EFFECTS, edgePoint, nearestEdge, separateEndpoint } from './effects';
import type { Effects } from './effects';

export function AdvancedSettings({
  effects = DEFAULT_EFFECTS,
  change,
  disabled,
}: {
  effects?: Effects;
  change(effects: Effects): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const update = (value: Partial<Effects>) => change({ ...effects, ...value });
  return (
    <div className="control-group advanced-settings">
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Advanced settings
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <fieldset disabled={disabled}>
            <label className="advanced-field">
              Blend with source
              <select
                value={effects.blend}
                onChange={(e) => update({ blend: e.target.value as Effects['blend'] })}
              >
                <option value="off">Off</option>
                <option value="hard">Direct seam</option>
                <option value="feather">Feather / alpha blend</option>
                <option value="pyramid">Pyramid blend</option>
              </select>
            </label>
            {effects.blend !== 'off' && (
              <>
                <p className="field-note">
                  Drag either endpoint around the image edge to place the seam.
                </p>
                <div className="seam-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => update({ a: 0.125, b: 0.625 })}
                  >
                    Vertical seam
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => update({ a: 0.375, b: 0.875 })}
                  >
                    Horizontal seam
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => update({ flip: !effects.flip })}
                  >
                    Swap sides
                  </button>
                </div>
              </>
            )}
            {effects.blend === 'feather' && (
              <label className="advanced-field">
                Feather width
                <span className="advanced-value" aria-hidden="true">
                  {Math.round(effects.feather * 100)}%
                </span>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={Math.round(effects.feather * 100)}
                  onChange={(e) => update({ feather: +e.target.value / 100 })}
                />
              </label>
            )}
            <label className="advanced-field">
              Chromatic aberration
              <span className="advanced-value" aria-hidden="true">
                {Math.round(effects.aberration * 100)}%
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(effects.aberration * 100)}
                onChange={(e) => update({ aberration: +e.target.value / 100 })}
              />
            </label>
            <label className="advanced-field">
              Purple fringing
              <span className="advanced-value" aria-hidden="true">
                {Math.round(effects.purple * 100)}%
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(effects.purple * 100)}
                onChange={(e) => update({ purple: +e.target.value / 100 })}
              />
            </label>
            <button type="button" className="text-button" onClick={() => change(DEFAULT_EFFECTS)}>
              Reset effects
            </button>
          </fieldset>
        )}
      </div>
    </div>
  );
}

export function BlendHandles({
  effects,
  change,
  disabled,
}: {
  effects: Effects;
  change(effects: Effects): void;
  disabled?: boolean;
}) {
  const [ax, ay] = edgePoint(effects.a),
    [bx, by] = edgePoint(effects.b);
  const set = (which: 'a' | 'b', position: number) =>
    change({ ...effects, [which]: separateEndpoint(position, effects[which === 'a' ? 'b' : 'a']) });
  const move = (which: 'a' | 'b', event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
    set(
      which,
      nearestEdge(
        (event.clientX - bounds.left) / bounds.width,
        (event.clientY - bounds.top) / bounds.height,
        bounds.width,
        bounds.height,
      ),
    );
  };
  return (
    <div className="blend-handles" role="group" aria-label="Blend divider">
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line
          x1={ax * 100}
          y1={ay * 100}
          x2={bx * 100}
          y2={by * 100}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {(['a', 'b'] as const).map((which, i) => {
        const [x, y] = edgePoint(effects[which]);
        return (
          <button
            type="button"
            role="slider"
            aria-label={`Blend endpoint ${which.toUpperCase()}`}
            aria-valuemin={0}
            aria-valuemax={999}
            aria-valuenow={Math.min(999, Math.round(effects[which] * 1000))}
            aria-valuetext={`${Math.round(effects[which] * 100)}% around the edge`}
            className="blend-endpoint"
            key={which}
            disabled={disabled}
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              move(which, e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) move(which, e);
            }}
            onKeyDown={(e) => {
              if (
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
              ) {
                e.preventDefault();
                const step = e.shiftKey ? 0.06 : 0.0125;
                set(
                  which,
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? 0.999
                      : effects[which] + (['ArrowUp', 'ArrowRight'].includes(e.key) ? step : -step),
                );
              }
            }}
          >
            {i ? 'B' : 'A'}
          </button>
        );
      })}
    </div>
  );
}
