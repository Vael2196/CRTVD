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
  { type: 'probe'; file: File } | { type: 'convert'; file: File; options: AnimationOptions };
export type AnimationResponse =
  | { type: 'info'; info: ClipInfo }
  | { type: 'progress'; phase: 'palette' | 'encoding'; fraction: number; frame: number }
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
    }
  | { type: 'error'; message: string };
