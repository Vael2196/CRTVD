export type TonePoint = [number, number];
export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';
export type Curves = Partial<Record<CurveChannel, TonePoint[]>>;
export const CHANNELS: CurveChannel[] = ['rgb', 'red', 'green', 'blue'];
export const identity = (): TonePoint[] => [
  [0, 0],
  [255, 255],
];
export const MAX_POINTS = 12;

export function curveLut(points: TonePoint[] = identity()) {
  const secants = points.slice(1).map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
  // Monotone cubic interpolation on each interval. Turning points have zero
  // slope, so they do not overshoot beyond the chosen shadows/highlights.
  const slopes = points.map((_, i) => {
    const a = secants[i - 1],
      b = secants[i];
    return a === undefined ? b : b === undefined ? a : a * b <= 0 ? 0 : 2 / (1 / a + 1 / b);
  });
  let i = 0;
  return Uint8Array.from({ length: 256 }, (_, x) => {
    while (i + 2 < points.length && x > points[i + 1][0]) i++;
    const [a, ya] = points[i],
      [b, yb] = points[i + 1];
    const t = (x - a) / (b - a),
      t2 = t * t,
      t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ya +
      (t3 - 2 * t2 + t) * (b - a) * slopes[i] +
      (-2 * t3 + 3 * t2) * yb +
      (t3 - t2) * (b - a) * slopes[i + 1];
    return Math.round(Math.max(Math.min(ya, yb), Math.min(Math.max(ya, yb), y)));
  });
}

export function grade(curves: Curves) {
  const [master, ...rgb] = CHANNELS.map((channel) => curveLut(curves[channel]));
  const tables = rgb.map((table) => master.map((v) => table[v]));
  return (input: Uint8Array<ArrayBuffer>) => {
    const out = input.slice();
    for (let i = 0; i < out.length; i += 4)
      if (input[i + 3]) for (let c = 0; c < 3; c++) out[i + c] = tables[c][out[i + c]];
    return out;
  };
}
