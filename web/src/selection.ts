import { rgbKey } from './filters';

export const NO_SWATCH = 65535;

// Slots belong to the working palette, before post-effects or blend colours are added.
export function slotIndex(pixels: Uint8Array, palette: ArrayLike<number>) {
  const lookup = new Map<number, number>();
  for (let i = 0; i < palette.length; i += 3)
    lookup.set(rgbKey(palette[i], palette[i + 1], palette[i + 2]), i / 3);
  const slots = new Uint16Array(pixels.length / 4);
  for (let p = 0, i = 0; p < slots.length; p++, i += 4)
    slots[p] = pixels[i + 3]
      ? (lookup.get(rgbKey(pixels[i], pixels[i + 1], pixels[i + 2])) ?? NO_SWATCH)
      : NO_SWATCH;
  return slots;
}

export function swatchSlots(selection: number[], count: number) {
  return count ? new Set(selection.map((slot) => Math.min(count - 1, slot))) : new Set<number>();
}

export function toggleSlot(selection: number[], slot: number, count: number) {
  if (slot < 0 || slot >= count) return selection;
  const current = swatchSlots(selection, count);
  if (current.has(slot)) return selection.filter((index) => Math.min(count - 1, index) !== slot);
  return [...selection, slot];
}

export function pickSlot(map: ArrayBuffer, width: number, height: number, x: number, y: number) {
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return NO_SWATCH;
  return new Uint16Array(map)[Math.floor(y * height) * width + Math.floor(x * width)];
}
