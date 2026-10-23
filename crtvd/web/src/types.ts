export type PaletteMode = 'adaptive' | 'monochrome' | 'handheld' | 'cga';
export type Dither = 'none' | 'bayer' | 'floyd';
export type Resample = 'area' | 'nearest';

export interface Settings {
  targetWidth: number;
  palette: PaletteMode;
  colours: number;
  dither: Dither;
  strength: number;
  resample: Resample;
}

export const DEFAULT_SETTINGS: Settings = {
  targetWidth: 160,
  palette: 'adaptive',
  colours: 16,
  dither: 'bayer',
  strength: 0.65,
  resample: 'area',
};

export interface SourceImage {
  name: string;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

export type WorkerRequest =
  | { type: 'source'; generation: number; width: number; height: number; rgba: ArrayBuffer }
  | {
      type: 'process';
      generation: number;
      id: number;
      width: number;
      height: number;
      settings: Settings;
    };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'source-ready'; generation: number }
  | {
      type: 'result';
      generation: number;
      id: number;
      width: number;
      height: number;
      rgba: ArrayBuffer;
      palette: number[];
      milliseconds: number;
    }
  | { type: 'error'; message: string; generation?: number; id?: number };

// This is the C API exported by Emscripten; numbers used as pointers are byte
// offsets into the module's linear memory, not JavaScript object references.
export interface CrtvdModule {
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _crtvd_process(
    pointer: number,
    length: number,
    iw: number,
    ih: number,
    ow: number,
    oh: number,
    palette: number,
    colours: number,
    dither: number,
    strength: number,
    resample: number,
  ): number;
  _crtvd_last_error(): number;
  UTF8ToString(pointer: number): string;
  _crtvd_result_pixels(result: number): number;
  _crtvd_result_length(result: number): number;
  _crtvd_result_palette(result: number): number;
  _crtvd_result_palette_length(result: number): number;
  _crtvd_result_free(result: number): void;
}
