import { createGifEncoder } from './gif-encoder';
import {
  BufferTarget,
  Output,
  CanvasSource,
  WebMOutputFormat,
  Mp4OutputFormat,
  Quality,
  canEncodeVideo,
} from 'mediabunny';
import type { AnimationFormat } from './types';
import { LIMITS } from './limits';

export interface FrameWriter {
  add(rgba: Uint8Array, palette: Uint8Array, timestamp: number, duration: number): Promise<void>;
  finish(): Promise<Uint8Array<ArrayBuffer>>;
  cancel(): Promise<void>;
}

export function gifWriter(width: number, height: number, repeat: number): FrameWriter {
  const encoder = createGifEncoder();
  let frame = 0;
  let paletteKey = '';
  let colours: number[][] = [];
  let indices = new Map<number, number>();
  return {
    async add(rgba, palette, timestamp, duration) {
      const key = Array.from(palette).join(',');
      if (frame && key !== paletteKey)
        throw new Error('The shared GIF palette changed during encoding.');
      if (!frame) {
        if (palette.length > 255 * 3)
          throw new Error('GIF export reserves one of 256 entries for transparency.');
        paletteKey = key;
        colours = [[0, 0, 0]];
        indices = new Map();
        for (let i = 0; i < palette.length; i += 3) {
          indices.set((palette[i] << 16) | (palette[i + 1] << 8) | palette[i + 2], colours.length);
          colours.push([palette[i], palette[i + 1], palette[i + 2]]);
        }
      }
      const indexed = new Uint8Array(width * height);
      for (let i = 0; i < indexed.length; i++) {
        const p = i * 4;
        if (rgba[p + 3] < 128) {
          indexed[i] = 0;
          continue;
        }
        const index = indices.get((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
        if (index === undefined)
          throw new Error('The engine returned a colour outside the shared palette.');
        indexed[i] = index;
      }
      // Round absolute boundaries, rather than every duration independently,
      // so 30 fps -> GIF centiseconds does not accumulate timing drift.
      const delay =
        Math.max(1, Math.round((timestamp + duration) * 100) - Math.round(timestamp * 100)) * 10;
      encoder.writeFrame(indexed, width, height, {
        ...(frame === 0 ? { palette: colours } : {}),
        transparent: true,
        transparentIndex: 0,
        delay,
        repeat,
        dispose: 2,
      });
      frame++;
      if (encoder.bytesView().length > LIMITS.outputBytes)
        throw new Error('The encoded GIF exceeds 64 MiB. Use a smaller output width.');
    },
    async finish() {
      if (!frame) throw new Error('No frames were encoded.');
      encoder.finish();
      return encoder.bytes();
    },
    async cancel() {
      /* No browser encoder handles to release. */
    },
  };
}

export async function videoWriter(
  format: Exclude<AnimationFormat, 'gif'>,
  width: number,
  height: number,
  fps: number,
): Promise<FrameWriter> {
  if (typeof VideoEncoder === 'undefined')
    throw new Error('This browser does not support WebCodecs video encoding. Choose GIF output.');
  const codec = format === 'webm' ? 'vp8' : 'avc';
  // Some H.264 encoders require even coded dimensions. Pad on the right/bottom
  // rather than stretching or silently resampling a palette-limited image.
  const codedWidth = format === 'mp4' ? Math.ceil(width / 2) * 2 : width;
  const codedHeight = format === 'mp4' ? Math.ceil(height / 2) * 2 : height;
  const quality = new Quality({ bitrate: 3_000_000 });
  if (
    !(await canEncodeVideo(codec, {
      width: codedWidth,
      height: codedHeight,
      quality,
      frameRate: fps,
    }))
  )
    throw new Error(
      `Your browser cannot encode ${format === 'mp4' ? 'MP4/H.264' : 'WebM/VP8'} at this size. Choose GIF or another available video format.`,
    );
  const canvas = new OffscreenCanvas(codedWidth, codedHeight);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({
    format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  let encodedBytes = 0;
  const source = new CanvasSource(canvas, {
    codec,
    quality,
    alpha: 'discard',
    keyFrameInterval: 2,
    onEncodedPacket(packet) {
      encodedBytes += packet.data.byteLength;
      if (encodedBytes > LIMITS.outputBytes)
        throw new Error('The encoded video exceeds 64 MiB. Use a smaller output width.');
    },
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  let frames = 0;
  return {
    async add(rgba, _palette, timestamp, duration) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, codedWidth, codedHeight);
      const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      await source.add(timestamp, duration);
      frames++;
    },
    async finish() {
      if (!frames) throw new Error('No frames were encoded.');
      source.close();
      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer || buffer.byteLength > LIMITS.outputBytes)
        throw new Error('The encoded video exceeds the output size limit.');
      return new Uint8Array(buffer);
    },
    async cancel() {
      await output.cancel();
    },
  };
}
