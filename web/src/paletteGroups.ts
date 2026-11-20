import { srgb } from './filters';
import { lab } from './palettes';
import type { RGB } from './palettes';

const dist = (p: RGB, q: RGB) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const mean = (p: RGB[]): RGB =>
  [0, 1, 2].map((c) => p.reduce((sum, q) => sum + q[c], 0) / p.length) as RGB;
function fromLab([l, a, b]: RGB): RGB {
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    srgb(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    srgb(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    srgb(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}
export const averageColours = (colours: RGB[]) => fromLab(mean(colours.map(lab)));

export function organisePalette(palette: RGB[], count: number) {
  if (!palette.length) return [];
  const points = palette.map(lab);
  const centres: RGB[] = [points[0]];
  while (centres.length < Math.min(12, count, points.length)) {
    const far = points.map((p) => Math.min(...centres.map((c) => dist(c, p))));
    const best = Math.max(...far);
    if (best < 1e-12) break;
    centres.push(points[far.indexOf(best)]);
  }
  let groups: number[][] = [];
  for (let pass = 0; pass < 8; pass++) {
    groups = centres.map(() => []);
    for (const [i, p] of points.entries()) {
      const d = centres.map((c) => dist(c, p));
      groups[d.indexOf(Math.min(...d))].push(i);
    }
    for (const [i, group] of groups.entries())
      if (group.length) centres[i] = mean(group.map((n) => points[n]));
  }
  return groups
    .filter((group) => group.length)
    .map((slots) => ({ slots, representative: averageColours(slots.map((i) => palette[i])) }));
}

export function shiftGroup(palette: RGB[], slots: number[], target: RGB) {
  const points = slots.map((i) => lab(palette[i])),
    center = mean(points),
    next = lab(target);
  return points.map((p, i) => ({
    slot: slots[i],
    rgb: fromLab(p.map((v, c) => v + next[c] - center[c]) as RGB),
  }));
}
