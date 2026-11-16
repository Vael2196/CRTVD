export type Point = [number, number];
export type MaskShape = 'line' | 'ellipse' | 'rectangle' | 'curve' | 'freehand';
export const MAX_STROKE = 80;

export interface Geometry {
  a: number;
  b: number;
  shape: MaskShape;
  centre: Point;
  span: Point;
  angle: number;
  bow: Point;
  stroke: Point[];
}

const wrap = (x: number) => ((x % 1) + 1) % 1;
export function edgePoint(position: number): Point {
  const p = wrap(position) * 4;
  return p < 1 ? [p, 0] : p < 2 ? [1, p - 1] : p < 3 ? [3 - p, 1] : [0, 4 - p];
}

export function nearestEdge(x: number, y: number, w: number, h: number) {
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  const distances = [y * h, (1 - x) * w, (1 - y) * h, x * w];
  return wrap([x, 1 + y, 3 - x, 4 - y][distances.indexOf(Math.min(...distances))] / 4);
}

function borderPath(from: number, to: number, direction: 1 | -1): Point[] {
  const travel = wrap((to - from) * direction);
  const corners = [0, 0.25, 0.5, 0.75].map((i) => [i, wrap((i - from) * direction)]);
  return [
    edgePoint(from),
    ...corners
      .filter(([, t]) => t > 1e-8 && t < travel - 1e-8)
      .sort((a, b) => a[1] - b[1])
      .map(([i]) => edgePoint(i)),
    edgePoint(to),
  ];
}

const dist = (a: Point, b: Point, w: number, h: number) =>
  Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h);

export function finishStroke(path: Point[], w: number, h: number): Point[] {
  if (path.length < 2) return [];
  const first = path[0],
    last = path[path.length - 1];
  const f = nearestEdge(...first, w, h),
    l = nearestEdge(...last, w, h);
  const close = dist(first, last, w, h);
  const border = dist(first, edgePoint(f), w, h) + dist(last, edgePoint(l), w, h);
  if (close <= border) return path.length >= 3 ? path : [];
  const clockwise = borderPath(l, f, 1);
  const counter = borderPath(l, f, -1);
  const length = (points: Point[]) =>
    points.slice(1).reduce((sum, p, i) => sum + dist(points[i], p, w, h), 0);
  return [...path, ...(length(clockwise) <= length(counter) ? clockwise : counter)];
}

// Width/height are fractions of the image. Rotation uses the display's aspect
// ratio, so a 45 degree edge remains 45 degrees on a non-square image.
export function transformed(g: Geometry, w: number, h: number, x: number, y: number): Point {
  const t = (g.angle * Math.PI) / 180,
    c = Math.cos(t),
    s = Math.sin(t);
  return [g.centre[0] + (x * c - ((y * h) / w) * s), g.centre[1] + (((x * w) / h) * s + y * c)];
}

export function outline(g: Geometry, w: number, h: number): Point[] {
  const a = edgePoint(g.a),
    b = edgePoint(g.b);
  if (g.shape === 'line') return [a, b];
  if (g.shape === 'freehand') return g.stroke;
  if (g.shape === 'curve')
    return Array.from({ length: 33 }, (_, i) => {
      const t = i / 32,
        u = 1 - t;
      return [
        u * u * a[0] + 2 * u * t * g.bow[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * g.bow[1] + t * t * b[1],
      ];
    });
  const [rx, ry] = g.span.map((n) => n / 2);
  if (g.shape === 'rectangle')
    return [
      transformed(g, w, h, -rx, -ry),
      transformed(g, w, h, rx, -ry),
      transformed(g, w, h, rx, ry),
      transformed(g, w, h, -rx, ry),
    ];
  const short = Math.min(w, h);
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    return transformed(g, w, h, (short / w) * rx * Math.cos(t), (short / h) * ry * Math.sin(t));
  });
}

export function maskPolygon(g: Geometry, w: number, h: number) {
  const path = outline(g, w, h);
  if (g.shape === 'curve') return [...path, ...borderPath(g.b, g.a, 1)];
  return path;
}

function distanceToEdge(
  x: number,
  y: number,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  length2: number,
) {
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (length2 || 1)));
  return (x - ax - u * dx) ** 2 + (y - ay - u * dy) ** 2;
}

export function polygonDistance(points: Point[], w: number, h: number, feather: boolean) {
  const segments = points.map(([x, y], i) => {
    const a = points[(i + points.length - 1) % points.length];
    const ax = a[0] * w,
      ay = a[1] * h,
      bx = x * w,
      by = y * h,
      dx = bx - ax,
      dy = by - ay;
    const perimeter =
      (ax === bx && (ax === 0 || ax === w)) || (ay === by && (ay === 0 || ay === h));
    return { ax, ay, bx, by, dx, dy, perimeter, length2: dx * dx + dy * dy };
  });
  return (x: number, y: number) => {
    let inside = false,
      min = Infinity;
    for (const s of segments) {
      if (s.ay > y !== s.by > y && x < s.ax + ((y - s.ay) * s.dx) / s.dy) inside = !inside;
      if (feather && !s.perimeter)
        min = Math.min(min, distanceToEdge(x, y, s.ax, s.ay, s.dx, s.dy, s.length2));
    }
    return (inside ? 1 : -1) * (feather ? Math.sqrt(min) : 1);
  };
}
