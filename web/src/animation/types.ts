import type { Settings } from '../types';

export type AnimationFormat = 'gif' | 'webm' | 'mp4';
export interface AnimationOptions {
  settings: Settings;
  format: AnimationFormat;
  fps: number;
  matte: string;
}
export interface ClipInfo {
  kind: 'gif' | 'video';
  width: number;
  height: number;
  duration: number;
  frameCount: number | null;
  codec: string;
  hasAudio: boolean;
  repeat: number;
}
export interface ClipFrame {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  timestamp: number;
  duration: number;
}
export interface ClipSource {
  info: ClipInfo;
  frames(fps: number): AsyncGenerator<ClipFrame>;
  dispose(): void;
}
export type AnimationRequest =
  | { type: 'probe'; file: File }
  | { type: 'convert'; file: File; options: AnimationOptions }
  | { type: 'preview'; file: File; options: AnimationOptions; trainedPalette?: number[] };
export type AnimationResponse =
  | { type: 'info'; info: ClipInfo }
  | {
      type: 'preview';
      rgba: ArrayBuffer;
      width: number;
      height: number;
      palette: number[];
      originalPalette: number[];
    }
  | { type: 'progress'; phase: 'palette' | 'effects' | 'encoding'; fraction: number; frame: number }
  | {
      type: 'done';
      bytes: ArrayBuffer;
      mime: string;
      extension: string;
      width: number;
      height: number;
      frames: number;
      duration: number;
      palette: number[];
      originalPalette: number[];
    }
  | { type: 'error'; message: string };
