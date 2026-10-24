import { parseGIF, decompressFrame } from 'gifuct-js';
import type { ClipFrame, ClipSource } from './types';
import { LIMITS, validateDimensions, validateDuration } from './limits';

type RawFrame = Parameters<typeof decompressFrame>[0];

// Pure compositing makes disposal behaviour independently testable. The canvas
// is a logical screen; many GIF frames are only a small patch within it.
export function readGif(buffer: ArrayBuffer): ClipSource {
  if (buffer.byteLength > LIMITS.gifBytes) throw new Error('GIF files must be at most 16 MiB.');
  const signature = String.fromCharCode(
    ...new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength)),
  );
  if (!['GIF87a', 'GIF89a'].includes(signature))
    throw new Error('This is not a GIF87a/GIF89a file.');
  const gif = parseGIF(buffer);
  const { width, height } = gif.lsd;
  validateDimensions(width, height);
  const frames = gif.frames.filter((frame): frame is RawFrame => 'image' in frame);
  if (!frames.length || frames.length > LIMITS.frames)
    throw new Error('GIFs must contain 1–900 image frames.');
  const delays = frames.map((frame) => (frame.gce?.delay || 10) / 100);
  const duration = delays.reduce((a, b) => a + b, 0);
  validateDuration(duration);
  for (const frame of frames) {
    const d = frame.image.descriptor;
    validateDimensions(d.width, d.height);
    if (d.left < 0 || d.top < 0 || d.left + d.width > width || d.top + d.height > height)
      throw new Error('A GIF frame lies outside its logical screen.');
    if (frame.image.data.minCodeSize < 2 || frame.image.data.minCodeSize > 8)
      throw new Error('This GIF has an invalid LZW code size.');
    if ((frame.gce?.extras.disposal ?? 0) > 3 || frame.gce?.extras.userInput)
      throw new Error('This GIF uses unsupported disposal or interactive timing.');
  }
  let repeat = -1;
  for (const frame of gif.frames)
    if ('application' in frame && /^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(frame.application.id)) {
      const b = frame.application.blocks;
      if (b?.length >= 3 && b[0] === 1) repeat = b[1] | (b[2] << 8);
    }
  // Browser-style transparent GIF background. Without transparency, disposal 2
  // restores the logical screen's global background colour instead.
  const transparent = frames.some((f) => f.gce?.extras.transparentColorGiven);
  const bg = !transparent ? gif.gct?.[gif.lsd.backgroundColorIndex] : undefined;
  const background: number[] = bg ? [...bg, 255] : [0, 0, 0, 0];
  return {
    info: {
      kind: 'gif',
      width,
      height,
      duration,
      frameCount: frames.length,
      codec: 'GIF89a',
      hasAudio: false,
      repeat,
    },
    async *frames(): AsyncGenerator<ClipFrame> {
      const screen = new Uint8ClampedArray(width * height * 4);
      const fill = (left: number, top: number, w: number, h: number) => {
        for (let y = top; y < top + h; y++)
          for (let x = left; x < left + w; x++) screen.set(background, (y * width + x) * 4);
      };
      fill(0, 0, width, height);
      let previous: ReturnType<typeof decompressFrame> | undefined;
      let restore: Uint8ClampedArray<ArrayBuffer> | undefined;
      let timestamp = 0;
      for (let i = 0; i < frames.length; i++) {
        if (previous?.disposalType === 2) {
          const d = previous.dims;
          fill(d.left, d.top, d.width, d.height);
        } else if (previous?.disposalType === 3 && restore) screen.set(restore);
        const decoded = decompressFrame(frames[i], gif.gct ?? [], true);
        restore = decoded.disposalType === 3 ? screen.slice() : undefined;
        const d = decoded.dims;
        if (decoded.patch.length !== d.width * d.height * 4)
          throw new Error('The GIF frame could not be decoded.');
        for (let y = 0; y < d.height; y++)
          for (let x = 0; x < d.width; x++) {
            const from = (y * d.width + x) * 4;
            if (decoded.patch[from + 3])
              screen.set(
                decoded.patch.subarray(from, from + 4),
                ((y + d.top) * width + x + d.left) * 4,
              );
          }
        // Consumers finish with this borrowed frame before the iterator advances.
        yield { rgba: screen, width, height, timestamp, duration: delays[i] };
        timestamp += delays[i];
        previous = decoded;
      }
    },
    dispose() {
      /* Only compressed bytes remain; no decoder handles to release. */
    },
  };
}
