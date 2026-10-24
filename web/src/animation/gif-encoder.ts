import gifenc from 'gifenc';

// gifenc publishes an ESM default function and a CommonJS default object.
// Normalise them so browser builds and Node-based codec tests use the same API.
export const createGifEncoder = typeof gifenc === 'function' ? gifenc : gifenc.GIFEncoder;
