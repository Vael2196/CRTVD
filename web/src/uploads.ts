const MiB = 1024 * 1024;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const extensions: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function isCancelled(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function mimeFor(file: File) {
  const type = file.type.toLowerCase().split(';')[0].trim();
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (!type || type === 'application/octet-stream') {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return Object.hasOwn(extensions, ext) ? extensions[ext] : type;
  }
  return type;
}

function readBytes(file: File, signal?: AbortSignal): Promise<ArrayBuffer> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reader.onload = reader.onerror = reader.onabort = null;
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      fail(new DOMException('Cancelled', 'AbortError'));
      reader.abort();
    };
    const timer = setTimeout(() => {
      fail(
        new Error(
          'Reading this file took too long. Download it to this device, then select it again.',
        ),
      );
      reader.abort();
    }, 30_000);
    reader.onload = () => {
      const bytes = reader.result;
      cleanup();
      if (bytes instanceof ArrayBuffer) resolve(bytes);
      else reject(new Error('The browser returned no file data. Select the file again.'));
    };
    const readError = () =>
      fail(
        new Error(
          'Your browser could not read this file. Save or download it to this device, then select it again from Files or Downloads instead of a cloud-only item.',
        ),
      );
    reader.onerror = readError;
    reader.onabort = () => fail(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      reader.readAsArrayBuffer(file);
    } catch {
      readError();
    }
  });
}

/** Read the picker/provider file once, on the main thread, before resetting
 * its input or passing it to workers. new File([file]) alone is a lazy Blob
 * wrapper, not a guarantee that the underlying storage has been read. */
export async function snapshotFile(file: File, kind: 'image' | 'animation', signal?: AbortSignal) {
  throwIfCancelled(signal);
  const type = mimeFor(file);
  if (kind === 'image' && !imageTypes.has(type)) {
    if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(type))
      throw new Error(
        'HEIC/HEIF photos are not supported. Export or save the photo as JPEG or PNG, then choose that copy.',
      );
    throw new Error(
      'Choose a PNG, JPEG, WebP or AVIF still image. For GIF or video, use Animation.',
    );
  }
  const gif = type === 'image/gif' || /\.gif$/i.test(file.name);
  const max = kind === 'image' ? 32 * MiB : gif ? 16 * MiB : 64 * MiB;
  const tooLarge =
    kind === 'image'
      ? 'Choose a file smaller than 32 MB.'
      : gif
        ? 'GIF files must be at most 16 MiB.'
        : 'Animation inputs must be at most 64 MiB (GIF: 16 MiB).';
  if (file.size > max) throw new Error(tooLarge);
  if (!file.size)
    throw new Error(
      'This file is empty or has not downloaded. Save a local copy, then choose it again.',
    );
  const bytes = await readBytes(file, signal);
  throwIfCancelled(signal);
  if (bytes.byteLength > max) throw new Error(tooLarge);
  if (bytes.byteLength !== file.size)
    throw new Error(
      'The file changed or was not read completely. Save a local copy and select it again.',
    );
  return new File([bytes], file.name, { type, lastModified: file.lastModified });
}
