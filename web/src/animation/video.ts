import { Input, MP4, WEBM, BlobSource, CanvasSink } from 'mediabunny';
import type { ClipSource } from './types';
import { LIMITS, validateDimensions, validateDuration } from './limits';
import { readGif } from './gif';

export async function openClip(file: File): Promise<ClipSource> {
  if (file.size > LIMITS.inputBytes)
    throw new Error('Animation inputs must be at most 64 MiB (GIF: 16 MiB).');
  const header = String.fromCharCode(...new Uint8Array(await file.slice(0, 6).arrayBuffer()));
  if (header === 'GIF87a' || header === 'GIF89a') return readGif(await file.arrayBuffer());
  if (!/\.(mp4|webm)$/i.test(file.name))
    throw new Error('Choose a GIF, MP4 (H.264) or WebM (VP8/VP9) file.');
  if (typeof VideoDecoder === 'undefined')
    throw new Error(
      'This browser does not support WebCodecs video decoding. GIF conversion is still available.',
    );
  const input = new Input({ formats: [MP4, WEBM], source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no video track.');
    const codec = await track.getCodec();
    const format = await input.getFormat();
    if (
      (format === MP4 && codec !== 'avc') ||
      (format === WEBM && codec !== 'vp8' && codec !== 'vp9') ||
      (format !== MP4 && format !== WEBM)
    )
      throw new Error(
        'Supported input profiles are MP4/H.264 and WebM/VP8 or VP9. HEVC, AV1 and MOV are not included.',
      );
    const width = Math.round(await track.getDisplayWidth()),
      height = Math.round(await track.getDisplayHeight());
    validateDimensions(width, height);
    // Reject huge coded frames even when rotation/aspect metadata makes the
    // display small. Decoders still allocate for the coded dimensions.
    validateDimensions(await track.getCodedWidth(), await track.getCodedHeight());
    if (await track.hasHighDynamicRange())
      throw new Error('Use an SDR video. HDR input is not supported in this release.');
    const start = Math.max(0, await track.getFirstTimestamp());
    const duration = (await track.computeDuration()) - start;
    validateDuration(duration);
    if (!(await track.canDecode()))
      throw new Error(
        `Your browser cannot decode this ${codec} video. Try GIF or another supported browser.`,
      );
    const hasAudio = (await input.getAudioTracks()).length > 0;
    return {
      info: {
        kind: 'video',
        width,
        height,
        duration,
        frameCount: null,
        codec: codec!,
        hasAudio,
        repeat: 0,
      },
      async *frames(fps: number) {
        const count = Math.ceil(duration * fps - 1e-7);
        if (count > LIMITS.frames)
          throw new Error('The selected sampling rate exceeds 900 output frames.');
        const timestamps = Array.from({ length: count }, (_, i) => start + i / fps);
        const sink = new CanvasSink(track, { poolSize: 1, alpha: true });
        let index = 0;
        for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
          if (!wrapped)
            throw new Error(
              `The video has no decodable frame at ${timestamps[index].toFixed(3)} seconds.`,
            );
          const canvas = wrapped.canvas;
          if (canvas.width !== width || canvas.height !== height)
            throw new Error('Variable-resolution videos are not supported.');
          const ctx = canvas.getContext('2d') as
            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!ctx) throw new Error('Could not read the decoded video frame.');
          yield {
            rgba: ctx.getImageData(0, 0, width, height).data,
            width,
            height,
            timestamp: index / fps,
            duration: Math.min(1 / fps, duration - index / fps),
          };
          index++;
        }
        if (index !== count) throw new Error('The decoder returned fewer frames than expected.');
      },
      dispose() {
        input.dispose();
      },
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}
