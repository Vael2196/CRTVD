import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { MAX_POINTS, curveLut, identity } from './curves';
import type { CurveChannel, Curves, TonePoint } from './curves';

export function CurveEditor({ curves, change }: { curves?: Curves; change(value?: Curves): void }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [selected, select] = useState(0);
  const dragging = useRef<number | null>(null);
  const points = curves?.[channel] ?? identity();
  const index = Math.min(selected, points.length - 1);
  const set = (value: TonePoint[]) => change({ ...curves, [channel]: value });
  const move = (i: number, x: number, y: number) => {
    const next = points.slice();
    next[i] = [
      i === 0
        ? 0
        : i === points.length - 1
          ? 255
          : Math.round(Math.max(points[i - 1][0] + 1, Math.min(points[i + 1][0] - 1, x))),
      Math.round(Math.min(255, Math.max(0, y))),
    ];
    set(next);
  };
  const position = (e: PointerEvent<SVGSVGElement>): TonePoint => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) * 255) / r.width),
      Math.round(255 - ((e.clientY - r.top) * 255) / r.height),
    ];
  };
  const remove = () => {
    if (!index || index === points.length - 1) return;
    set(points.filter((_, i) => i !== index));
    select(index - 1);
  };
  const reset = () => {
    const next = { ...curves };
    delete next[channel];
    change(Object.keys(next).length ? next : undefined);
    select(0);
  };
  const path = Array.from(curveLut(points), (y, x) => `${x},${255 - y}`).join(' ');
  const colour = { rgb: '#f9fbff', red: '#ff8a85', green: '#8bf0b4', blue: '#8dbeff' }[channel];
  return (
    <fieldset className="effect-block">
      <legend>Colour curves</legend>
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide curves' : 'Edit curves'}
      </button>
      {open && (
        <>
          <label className="advanced-field">
            Curve channel
            <select
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as CurveChannel);
                select(0);
              }}
            >
              <option value="rgb">RGB master</option>
              <option value="red">Red</option>
              <option value="green">Green</option>
              <option value="blue">Blue</option>
            </select>
          </label>
          <p className="field-note">
            Input runs left to right; output runs bottom to top. Click to add a point or drag one to
            adjust it.
          </p>
          <svg
            className="curve-plot"
            viewBox="0 0 255 255"
            role="img"
            aria-label={`${channel} colour curve`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const [x, y] = position(e);
              let i =
                e.target instanceof SVGCircleElement && e.target.dataset.point !== undefined
                  ? Number(e.target.dataset.point)
                  : points.findIndex(([px]) => Math.abs(px - x) < 4);
              if (i < 0) {
                if (points.length >= MAX_POINTS || x < 1 || x > 254) return;
                i = points.findIndex(([px]) => px > x);
                set([
                  ...points.slice(0, i),
                  [x, Math.max(0, Math.min(255, y))],
                  ...points.slice(i),
                ]);
              }
              dragging.current = i;
              select(i);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (dragging.current !== null) move(dragging.current, ...position(e));
            }}
            onLostPointerCapture={() => {
              dragging.current = null;
            }}
          >
            {[64, 128, 192].map((n) => (
              <path key={n} d={`M ${n} 0 v255 M 0 ${n} h255`} stroke="#465a76" fill="none" />
            ))}
            <path d="M 0 255 L 255 0" stroke="#687d96" fill="none" />
            <polyline points={path} stroke={colour} strokeWidth="2.5" fill="none" />
            {points.map(([x, y], i) => (
              <circle
                key={i}
                data-point={i}
                cx={x}
                cy={255 - y}
                r="7"
                fill={i === index ? colour : '#182943'}
                stroke={colour}
                strokeWidth="2"
              />
            ))}
          </svg>
          <label className="advanced-field">
            Curve point
            <select value={index} onChange={(e) => select(+e.target.value)}>
              {points.map(([x, y], i) => (
                <option key={i} value={i}>
                  {x} → {y}
                </option>
              ))}
            </select>
          </label>
          <label className="advanced-field">
            Input level
            <input
              type="range"
              min={0}
              max={255}
              value={points[index][0]}
              disabled={!index || index === points.length - 1}
              onChange={(e) => move(index, +e.target.value, points[index][1])}
            />
          </label>
          <label className="advanced-field">
            Output level
            <input
              type="range"
              min={0}
              max={255}
              value={points[index][1]}
              onChange={(e) => move(index, points[index][0], +e.target.value)}
            />
          </label>
          <div className="seam-actions">
            <button
              type="button"
              className="text-button"
              disabled={points.length >= MAX_POINTS}
              onClick={() => {
                const i = points
                  .slice(1)
                  .reduce(
                    (best, [x], n) =>
                      x - points[n][0] > points[best + 1][0] - points[best][0] ? n : best,
                    0,
                  );
                const x = Math.round((points[i][0] + points[i + 1][0]) / 2);
                set([...points.slice(0, i + 1), [x, curveLut(points)[x]], ...points.slice(i + 1)]);
                select(i + 1);
              }}
            >
              Add curve point
            </button>
            <button
              type="button"
              className="text-button"
              disabled={!index || index === points.length - 1}
              onClick={remove}
            >
              Remove point
            </button>
            <button type="button" className="text-button" onClick={reset}>
              Reset channel
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
