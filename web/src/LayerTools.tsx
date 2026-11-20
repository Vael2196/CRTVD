import { DEFAULT_EFFECTS } from './effects';
import type { Effects } from './effects';
import { MAX_LAYERS, MAX_MASKS, newMask } from './layers';
import type { Layer } from './layers';
import { MaskOptions } from './MaskTools';

type Selection = { layer: number; mask?: number };
const layerName = (layer: Layer) =>
  layer.kind === 'original'
    ? 'Original'
    : layer.kind === 'conversion'
      ? 'Conversion'
      : `Adjustment ${layer.id - 2}`;

export function layerControls(
  layers: Layer[] | undefined,
  selection: Selection,
  set: (layers: Layer[]) => void,
) {
  const layer = layers?.find((l) => l.id === selection.layer) ?? layers?.at(-1);
  const mask = layer?.masks.find((m) => m.id === selection.mask) ?? layer?.masks.at(-1);
  const maskEffects = mask
    ? {
        ...DEFAULT_EFFECTS,
        ...mask,
        blend: mask.feather ? ('feather' as const) : ('hard' as const),
      }
    : undefined;
  const updateLayer = (patch: Partial<Layer>) => {
    if (layers && layer) set(layers.map((l) => (l.id === layer.id ? { ...l, ...patch } : l)));
  };
  const updateMask = (effects: Effects) => {
    if (layer && mask)
      updateLayer({
        masks: layer.masks.map((m) => (m.id === mask.id ? newMask(m.id, effects) : m)),
      });
  };
  return { layer, mask, maskEffects, updateLayer, updateMask };
}

export function LayerTools({
  layers,
  selection,
  select,
  change,
  enable,
  exit,
}: {
  layers?: Layer[];
  selection: Selection;
  select(next: Selection): void;
  change(layers: Layer[]): void;
  enable(): void;
  exit(): void;
}) {
  const { layer, mask, maskEffects, updateLayer, updateMask } = layerControls(
    layers,
    selection,
    change,
  );
  const move = (i: number, d: number) => {
    if (!layers) return;
    const next = [...layers];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change(next);
  };
  return (
    <fieldset className="effect-block layer-tools">
      <legend>Layers</legend>
      {!layers ? (
        <>
          <p className="field-note">
            Stack the original, conversion and adjustments. Each layer can have several masks.
          </p>
          <button type="button" className="secondary-button" onClick={enable}>
            Enable layer stack
          </button>
        </>
      ) : (
        <>
          <p className="field-note">
            Top layers cover the layers below. Multiple masks reveal the union of their areas.
          </p>
          <ol className="layer-list">
            {[...layers].reverse().map((l, j) => {
              const i = layers.length - 1 - j,
                name = layerName(l);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    className="layer-select"
                    aria-pressed={layer?.id === l.id}
                    onClick={() => select({ layer: l.id })}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    className="layer-action"
                    aria-label={`${l.visible ? 'Hide' : 'Show'} ${name}`}
                    onClick={() =>
                      change(
                        layers.map((other) =>
                          other.id === l.id ? { ...l, visible: !l.visible } : other,
                        ),
                      )
                    }
                  >
                    {l.visible ? '●' : '○'}
                  </button>
                  <button
                    type="button"
                    className="layer-action"
                    disabled={i === layers.length - 1}
                    aria-label={`Move ${name} up`}
                    onClick={() => move(i, 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="layer-action"
                    disabled={i === 0}
                    aria-label={`Move ${name} down`}
                    onClick={() => move(i, -1)}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="seam-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={layers.length >= MAX_LAYERS}
              onClick={() => {
                const id = Math.max(2, ...layers.map((l) => l.id)) + 1;
                change([
                  ...layers,
                  {
                    id,
                    kind: 'adjustment',
                    visible: true,
                    opacity: 1,
                    masks: [],
                    adjustment: DEFAULT_EFFECTS,
                  },
                ]);
                select({ layer: id });
              }}
            >
              Add adjustment layer
            </button>
            <button type="button" className="text-button" onClick={exit}>
              Return to simple blend
            </button>
          </div>
          {layer && (
            <>
              <label className="advanced-field">
                Layer opacity <span aria-hidden="true">{Math.round(layer.opacity * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(layer.opacity * 100)}
                  onChange={(e) => updateLayer({ opacity: +e.target.value / 100 })}
                />
              </label>
              {layer.kind === 'adjustment' && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    change(layers.filter((l) => l.id !== layer.id));
                    select({ layer: 1 });
                  }}
                >
                  Remove adjustment
                </button>
              )}
              <div className="seam-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={layer.masks.length >= MAX_MASKS}
                  onClick={() => {
                    const id = Math.max(0, ...layer.masks.map((m) => m.id)) + 1;
                    updateLayer({
                      masks: [
                        ...layer.masks,
                        newMask(id, { ...DEFAULT_EFFECTS, shape: 'ellipse', feather: 0 }),
                      ],
                    });
                    select({ layer: layer.id, mask: id });
                  }}
                >
                  Add mask
                </button>
                {mask && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      updateLayer({ masks: layer.masks.filter((m) => m.id !== mask.id) })
                    }
                  >
                    Remove mask
                  </button>
                )}
              </div>
              {mask && maskEffects && (
                <>
                  <label className="advanced-field">
                    Active mask
                    <select
                      value={mask.id}
                      onChange={(e) => select({ layer: layer.id, mask: +e.target.value })}
                    >
                      {layer.masks.map((m) => (
                        <option key={m.id} value={m.id}>
                          Mask {m.id}: {m.shape}
                        </option>
                      ))}
                    </select>
                  </label>
                  <MaskOptions
                    effects={maskEffects}
                    update={(patch) => updateMask({ ...maskEffects, ...patch })}
                  />
                  <label className="advanced-field">
                    Mask feather <span aria-hidden="true">{Math.round(mask.feather * 100)}%</span>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={Math.round(mask.feather * 100)}
                      onChange={(e) =>
                        updateMask({ ...maskEffects, feather: +e.target.value / 100 })
                      }
                    />
                  </label>
                </>
              )}
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
