import type { AnimationOptions, ClipInfo } from './types';

export const LIMITS = {
  inputBytes: 64 * 1024 * 1024,
  gifBytes: 16 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  inputPixels: 1920 * 1080,
  inputDimension: 4096,
  outputPixels: 512 * 512,
  outputWidth: 512,
  seconds: 30,
  frames: 900,
} as const;

export function validateDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > LIMITS.inputDimension ||
    height > LIMITS.inputDimension ||
    width * height > LIMITS.inputPixels
  )
    throw new Error(
      'Use an animation with at most 2,073,600 pixels per frame and 4,096 pixels per side.',
    );
}
export function validateDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > LIMITS.seconds + 1e-6)
    throw new Error(
      'Choose an animation lasting more than zero and at most 30 seconds. Longer files must be trimmed first.',
    );
}
export function animationSize(info: Pick<ClipInfo, 'width' | 'height'>, requested: number) {
  let width = Math.max(
    1,
    Math.min(
      info.width,
      LIMITS.outputWidth,
      Math.round(requested),
      Math.floor(Math.sqrt((LIMITS.outputPixels * info.width) / info.height)),
    ),
  );
  let height = Math.max(1, Math.min(info.height, Math.round((width * info.height) / info.width)));
  while (width * height > LIMITS.outputPixels) {
    width--;
    height = Math.max(1, Math.round((width * info.height) / info.width));
  }
  return { width, height };
}
export function validateOptions(options: AnimationOptions) {
  const s = options.settings;
  if (
    !['gif', 'webm', 'mp4'].includes(options.format) ||
    ![10, 15, 20, 24, 25, 30].includes(options.fps) ||
    !/^#[0-9a-f]{6}$/i.test(options.matte) ||
    !Number.isInteger(s.targetWidth) ||
    s.targetWidth < 1 ||
    s.targetWidth > LIMITS.outputWidth ||
    !Number.isInteger(s.colours) ||
    s.colours < 2 ||
    s.colours > 256 ||
    !Number.isFinite(s.strength) ||
    s.strength < 0 ||
    s.strength > 1 ||
    !['adaptive', 'monochrome', 'handheld', 'cga'].includes(s.palette) ||
    !['area', 'nearest'].includes(s.resample) ||
    !['none', 'bayer', 'floyd'].includes(s.dither)
  )
    throw new Error('Invalid animation conversion settings.');
}
