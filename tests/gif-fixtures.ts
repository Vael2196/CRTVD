// Small, independently constructed GIFs. An LZW clear before each pixel keeps
// the code width fixed at 4 bits; this makes disposal fixtures easy to audit.
export interface FixtureFrame {
  pixels: number[];
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  dispose?: number;
  delay?: number;
  transparent?: boolean;
  interlaced?: boolean;
  palette?: number[][];
}
export function fixtureGif(frames: FixtureFrame[], width = 3, height = 2, repeat = 2) {
  const bytes: number[] = [];
  const push = (...n: number[]) => bytes.push(...n);
  const short = (n: number) => push(n & 255, n >> 8);
  push(...Array.from('GIF89a', (c) => c.charCodeAt(0)));
  short(width);
  short(height);
  push(0xf2, 0, 0);
  const palette = [
    [0, 0, 0],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
  ];
  for (const rgb of palette) push(...rgb);
  if (repeat >= 0) {
    push(0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1);
    short(repeat);
    push(0);
  }
  for (const f of frames) {
    push(0x21, 0xf9, 4, ((f.dispose ?? 1) << 2) | (f.transparent === false ? 0 : 1));
    short(f.delay ?? 10);
    push(0, 0);
    push(0x2c);
    short(f.left ?? 0);
    short(f.top ?? 0);
    short(f.width ?? width);
    short(f.height ?? height);
    push((f.interlaced ? 0x40 : 0) | (f.palette ? 0x82 : 0));
    if (f.palette) for (const rgb of f.palette) push(...rgb);
    const data = f.pixels.map((p) => (p << 4) | 8);
    data.push(9);
    push(3);
    for (let i = 0; i < data.length; i += 255) {
      const part = data.slice(i, i + 255);
      push(part.length, ...part);
    }
    push(0);
  }
  push(0x3b);
  return new Uint8Array(bytes);
}
