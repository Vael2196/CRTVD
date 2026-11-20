import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { edgePoint, finishStroke, MAX_STROKE, outline } from './maskGeometry';
import type { MaskShape, Point } from './maskGeometry';
import { traceClosure } from './edgeTrace';
import type { Effects } from './effects';

export function MaskOptions({
  effects,
  update,
}: {
  effects: Effects;
  update(patch: Partial<Effects>): void;
}) {
  const { shape } = effects;
  return (
    <>
      <label className="advanced-field">
        Blend shape
        <select value={shape} onChange={(e) => update({ shape: e.target.value as MaskShape })}>
          <option value="line">Straight line</option>
          <option value="ellipse">Ellipse / circle</option>
          <option value="rectangle">Rectangle</option>
          <option value="curve">Quadratic curve</option>
          <option value="freehand">Freehand outline</option>
        </select>
      </label>
      {shape === 'line' && (
        <div className="seam-actions">
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
            onClick={() => update({ a: 0.125, b: 0.625 })}
          >
            Vertical seam
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => update({ a: 0.75, b: 0.25 })}
          >
            Rising diagonal
          </button>
          <button type="button" className="text-button" onClick={() => update({ a: 0, b: 0.5 })}>
            Falling diagonal
          </button>
        </div>
      )}
      {(shape === 'ellipse' || shape === 'rectangle') && (
        <>
          <p className="field-note">
            Drag the centre handle to move the window. The inside reveals the source by default.
          </p>
          {shape === 'ellipse' && (
            <p className="field-note">
              Size is measured against the image’s shorter side. Match both values for a circle.
            </p>
          )}
          {(['Width', 'Height'] as const).map((name, i) => (
            <label key={name} className="advanced-field">
              Mask {name.toLowerCase()}
              <span className="advanced-value" aria-hidden="true">
                {Math.round(effects.span[i] * 100)}%
              </span>
              <input
                type="range"
                min="5"
                max="150"
                value={Math.round(effects.span[i] * 100)}
                onChange={(e) => {
                  const span: Point = [...effects.span];
                  span[i] = +e.target.value / 100;
                  update({ span });
                }}
              />
            </label>
          ))}
          <label className="advanced-field">
            Mask rotation
            <span className="advanced-value" aria-hidden="true">
              {effects.angle}°
            </span>
            <input
              type="range"
              min="-180"
              max="180"
              value={effects.angle}
              onChange={(e) => update({ angle: +e.target.value })}
            />
          </label>
          {shape === 'ellipse' && (
            <button
              type="button"
              className="text-button"
              onClick={() => update({ centre: [0.5, 0.5], span: [0.55, 0.55], angle: 0 })}
            >
              Reset ellipse
            </button>
          )}
        </>
      )}
      {shape === 'curve' && (
        <p className="field-note">
          Drag A or B along an edge. Drag the middle control to bend the curve.
        </p>
      )}
      {shape === 'freehand' && (
        <>
          <p className="field-note">
            Draw on the preview. CRTVD tries to follow nearby colour edges to close large gaps.
          </p>
          <button
            type="button"
            className="text-button clear-outline"
            disabled={!effects.stroke.length}
            onClick={() => update({ stroke: [] })}
          >
            Clear outline
          </button>
        </>
      )}
      <button type="button" className="text-button" onClick={() => update({ flip: !effects.flip })}>
        Swap sides
      </button>
    </>
  );
}

export function MaskOverlay({
  effects,
  change,
  disabled,
  getImage,
}: {
  effects: Effects;
  change(next: Effects): void;
  disabled?: boolean;
  getImage?(): ImageData | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<[number, number]>([1, 1]);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const drawing = useRef<Point[] | null>(null);
  useEffect(() => {
    const node = host.current!;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      if (bounds.width && bounds.height) setDimensions([bounds.width, bounds.height]);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const [w, h] = dimensions;
  const point = (e: PointerEvent<HTMLElement>): Point => {
    const r = host.current!.getBoundingClientRect();
    const cap = (n: number) => Math.max(0, Math.min(1, n));
    return [cap((e.clientX - r.left) / r.width), cap((e.clientY - r.top) / r.height)];
  };
  const { shape } = effects;
  const points = draft ?? outline(effects, w, h);
  const moveHandle = (key: 'centre' | 'bow', point: Point) => change({ ...effects, [key]: point });
  const control = (key: 'centre' | 'bow', label: string) => {
    const [x, y] = effects[key];
    return (
      <button
        type="button"
        className="blend-endpoint"
        aria-label={label}
        disabled={disabled}
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        onPointerDown={(e) => {
          if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) moveHandle(key, point(e));
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.08 : 0.015;
          const offset: Record<string, Point> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const delta = offset[e.key];
          if (delta) {
            e.preventDefault();
            moveHandle(key, [
              Math.min(1, Math.max(0, x + delta[0])),
              Math.min(1, Math.max(0, y + delta[1])),
            ]);
          }
        }}
      >
        {key === 'bow' ? 'C' : '+'}
      </button>
    );
  };
  const plot = (path: Point[]) => path.map(([x, y]) => `${100 * x},${100 * y}`).join(' ');
  return (
    <div className="blend-handles mask-overlay" ref={host}>
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        {shape === 'curve' && (
          <polyline
            className="mask-control-guides"
            points={plot([edgePoint(effects.a), effects.bow, edgePoint(effects.b)])}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {shape !== 'line' &&
          (shape === 'curve' || draft ? (
            <polyline points={plot(points)} vectorEffect="non-scaling-stroke" />
          ) : (
            <polygon points={plot(points)} vectorEffect="non-scaling-stroke" />
          ))}
      </svg>
      {shape === 'curve' && control('bow', 'Curve bend handle')}
      {(shape === 'ellipse' || shape === 'rectangle') && control('centre', 'Move blend shape')}
      {shape === 'freehand' && !disabled && (
        <div
          className="mask-draw-surface"
          role="region"
          aria-label="Draw blend outline"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = [point(e)];
            setDraft(drawing.current);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId) || !drawing.current) return;
            const p = point(e),
              path = drawing.current,
              last = path[path.length - 1];
            if (Math.hypot((last[0] - p[0]) * w, (last[1] - p[1]) * h) < 3) return;
            if (path.length >= MAX_STROKE)
              drawing.current = [...path.filter((_, i) => i === 0 || i % 2 === 1), p];
            else drawing.current = [...path, p];
            setDraft(drawing.current);
          }}
          onPointerUp={(e) => {
            if (!drawing.current) return;
            const end = point(e),
              path = [...drawing.current, end],
              start = path[0];
            const gap = Math.hypot((end[0] - start[0]) * w, (end[1] - start[1]) * h);
            const raster = gap > 12 ? getImage?.() : undefined;
            const closure = raster ? traceClosure(raster, end, start) : undefined;
            const stroke = closure?.length ? [...path, ...closure] : finishStroke(path, w, h);
            drawing.current = null;
            setDraft(null);
            if (stroke.length >= 3) change({ ...effects, stroke });
          }}
          onLostPointerCapture={() => {
            drawing.current = null;
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}
