import { fromHex } from './palettes';
import type { Settings } from './types';

const palette = (colours: string) => colours.split(' ').flatMap((colour) => fromHex(colour)!);
export interface Preset {
  name: string;
  detail: string;
  settings: Partial<Settings>;
}

export const recommended: Preset[] = [
  {
    name: 'Soft dusk',
    detail: '16 colours · ordered',
    settings: {
      palette: 'adaptive',
      colours: 16,
      dither: 'bayer',
      strength: 0.65,
      resample: 'area',
    },
  },
  {
    name: 'Paper & ink',
    detail: '2 colours · diffusion',
    settings: { palette: 'monochrome', dither: 'floyd', strength: 1, resample: 'area' },
  },
  {
    name: 'Pocket green',
    detail: '4 colours · ordered',
    settings: { palette: 'handheld', dither: 'bayer', strength: 0.85, resample: 'area' },
  },
  {
    name: 'Electric four',
    detail: '4 colours · diffusion',
    settings: { palette: 'cga', dither: 'floyd', strength: 0.8, resample: 'area' },
  },
  {
    name: 'Cross Section',
    detail: 'Gen X Soft Club · steel, moss & signal red',
    settings: {
      customPalette: palette(
        '0A1726 183952 2C6084 709CAA BBDAE8 E8F3EC 2B4334 627345 9DA052 E7462D',
      ),
      dither: 'bayer',
      strength: 0.45,
    },
  },
  {
    name: 'Last Train',
    detail: 'Gen X Soft Club · deep teal & orange',
    settings: {
      customPalette: palette(
        '061D1A 153930 25584D 4C8879 87AB96 C2D8C1 EEF2DC 763224 BD4026 EB581F',
      ),
      dither: 'floyd',
      strength: 0.6,
    },
  },
  {
    name: 'Silver Terminal',
    detail: 'Y2K · chrome, lilac & ice blue',
    settings: {
      customPalette: palette(
        '151D30 3E4563 64748C 8799B0 B1C8D8 E5ECF0 F5F6EF A994C8 7A92B9 B9DCBA',
      ),
      dither: 'bayer',
      strength: 0.5,
    },
  },
];

// RGB values from ColorAny's Retro Console collection. Titles shortened;
// these are themed combinations, not calibrated hardware palettes.
const retroData: [string, string][] = [
  ['Console Night', '6A1B9A FF6F20 00BCD4 F5F5F5 212121'],
  ['Pastel Pops', '1C1C1C 3A3A3A FAD02E FF6F61 6A0572 4ECDC4 FFFFFF'],
  ['Lavender Contrast', 'E3B5D4 4A2370 FF6F61 D3C6E2 F1F1F1 3B3B3B F8E5A0'],
  ['Pastel Blue Dream', 'A2DFF7 6BB4E5 FFD700 FF69B4 4B0082 FFFFFF 000000'],
  ['Mint Arcade', 'B2E0D6 FFC1CC FFD700 FFE6E6 D5C8FF FFB3FF FFFFFF'],
  ['Pastel Nostalgia', 'FFABAB FFC3A0 FF677D D4A5A5 392F5A 6C63FF F8EDDB'],
  ['Bold Pastels', 'FF6F61 6B5B95 88B04B F7CAC9 1C1C1C B1B1B1 E1B7FF'],
  ['Dark Mode Pastels', 'FF6F61 6A5B8A 88D8B0 F7B7A3 FFD700 FFFFFF 000000'],
  ['Pastel Dreams', 'FFB3BA FF677D D6B5E3 6A0572 1D1F20 A8B2C0 F6F7D7'],
  ['Green Highlights', '000000 3F3F3F 00FF00 A2A2A2 1A1A1A 007F00 BFFF00'],
  ['Dynamic Contrast', 'FF6F61 6A5ACD FFD700 00BFFF FFFFFF 4B0082 000000'],
  ['Vibrant Arcade', 'FFD300 00A3E0 00BFFF FF6F20 D1E8E2 1A1A1A FFFFFF'],
  ['Vivid on Black', 'FF3D00 FF6F00 FFD600 00E676 00B0FF D5006D 000000'],
  ['Dark Mode Console', 'FFD700 00BFFF 4B0082 2E8B57 1C1C1C F5CBA1 FF6F61'],
  ['Console Revival', '1E1E1E 00BFFF 32CD32 FFFFFF 808080 000000 FFD700'],
  ['Dark Meets Bright', '1E1E1E FFD700 00BFFF 4B0082 A9A9A9 FF4500 2C3E50'],
  ['Lavender & Yellow', '6200EA FFEB3B BB86FC 03DAC5 1A1A1A FBC02D FFFFFF'],
  ['Pastel Nights', 'FFD700 5B6DAB 1A1A1A 3D993D BDA0D8 F29D00 F6E1B2'],
];
export const retro: Preset[] = retroData.map(([name, values]) => ({
  name,
  detail: 'Retro console · ColorAny',
  settings: { customPalette: palette(values), dither: 'bayer', strength: 0.65 },
}));
