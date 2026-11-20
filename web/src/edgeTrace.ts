import type { Point } from './maskGeometry';

export function edgeRaster(
  media: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | undefined | null,
) {
  if (!media) return;
  const [w, h] =
    media instanceof HTMLCanvasElement
      ? [media.width, media.height]
      : media instanceof HTMLVideoElement
        ? [media.videoWidth, media.videoHeight]
        : [media.naturalWidth, media.naturalHeight];
  if (!w || !h) return;
  const canvas = document.createElement('canvas'),
    scale = Math.min(1, 160 / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

class Queue {
  private heap: [number, number][] = [];
  push(item: [number, number]) {
    const h = this.heap;
    let i = h.length;
    h.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p][0] <= item[0]) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = item;
  }
  pop() {
    const h = this.heap,
      first = h[0],
      last = h.pop();
    if (!last || !h.length) return first;
    let i = 0;
    while (2 * i + 1 < h.length) {
      let j = 2 * i + 1;
      if (j + 1 < h.length && h[j + 1][0] < h[j][0]) j++;
      if (last[0] <= h[j][0]) break;
      h[i] = h[j];
      i = j;
    }
    h[i] = last;
    return first;
  }
}

/** A small intelligent-scissors pass: cheapest 8-connected route on the original
 * raster, favouring high RGB/alpha gradients. Fall back when no edge supports it. */
export function traceClosure(
  { data, width: w, height: h }: ImageData,
  from: Point,
  to: Point,
): Point[] | undefined {
  const index = ([x, y]: Point) =>
    Math.min(h - 1, Math.floor(y * h)) * w + Math.min(w - 1, Math.floor(x * w));
  const start = index(from),
    end = index(to);
  const gap = Math.hypot((from[0] - to[0]) * w, (from[1] - to[1]) * h);
  if (gap < 5) return;
  const edge = new Float32Array(w * h);
  const contrast = (a: number, b: number) => {
    const u = a * 4,
      v = b * 4;
    return (
      Math.max(
        Math.abs(data[u + 3] - data[v + 3]),
        ...Array.from(
          { length: 3 },
          (_, c) => Math.abs(data[u + c] * data[u + 3] - data[v + c] * data[v + 3]) / 255,
        ),
      ) / 255
    );
  };
  for (let y = 0, p = 0; y < h; y++)
    for (let x = 0; x < w; x++, p++) {
      const horizontal = x > 0 && x < w - 1 ? contrast(p - 1, p + 1) : 0;
      const vertical = y > 0 && y < h - 1 ? contrast(p - w, p + w) : 0;
      edge[p] = Math.max(horizontal, vertical);
    }
  const distance = new Float32Array(w * h).fill(Infinity),
    parent = new Int32Array(w * h).fill(-1);
  const q = new Queue();
  distance[start] = 0;
  q.push([0, start]);
  for (let item = q.pop(); item; item = q.pop()) {
    const [cost, p] = item;
    if (cost > distance[p] + 1e-4) continue;
    if (p === end) break;
    const x = p % w,
      y = Math.floor(p / w);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        // Keep search near the opening and avoid unrelated distant edges.
        if (
          Math.hypot(nx - from[0] * w, ny - from[1] * h) +
            Math.hypot(nx - to[0] * w, ny - to[1] * h) >
          gap * 2.2 + 12
        )
          continue;
        const n = ny * w + nx,
          e = Math.max(edge[p], edge[n]),
          d = dx && dy ? Math.SQRT2 : 1;
        const next = cost + d * (1 + 12 * (1 - e) ** 3);
        if (next + 1e-4 < distance[n]) {
          distance[n] = next;
          parent[n] = p;
          q.push([next, n]);
        }
      }
  }
  if (parent[end] < 0) return;
  const path: number[] = [];
  for (let p = end; p !== start; p = parent[p]) path.push(p);
  path.reverse();
  if (path.filter((p) => edge[p] >= 0.16).length < path.length * 0.35) return;
  const points = path.map((p): Point => [((p % w) + 0.5) / w, (Math.floor(p / w) + 0.5) / h]);
  const step = Math.max(1, Math.ceil(points.length / 80));
  return points.filter((_, i) => i % step === 0).slice(0, -1);
}
