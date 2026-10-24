import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationRequest, AnimationResponse } from './types';

type Answer = Extract<AnimationResponse, { type: 'info' | 'done' }>;
export function useAnimationWorker() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Extract<AnimationResponse, { type: 'progress' }> | null>(
    null,
  );
  const current = useRef<{
    worker: Worker;
    reject: (error: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const stop = useCallback(() => {
    const active = current.current;
    current.current = null;
    if (active) {
      active.worker.terminate();
      clearTimeout(active.timer);
      active.reject(new DOMException('Cancelled', 'AbortError'));
    }
    setBusy(false);
    setProgress(null);
  }, []);
  useEffect(
    () => () => {
      const active = current.current;
      current.current = null;
      if (active) {
        active.worker.terminate();
        clearTimeout(active.timer);
        active.reject(new DOMException('Cancelled', 'AbortError'));
      }
    },
    [],
  );
  const run = useCallback(
    (request: AnimationRequest): Promise<Answer> => {
      stop();
      setBusy(true);
      setProgress(null);
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./animation.worker.ts', import.meta.url), {
          type: 'module',
        });
        const finish = (answer?: Answer, error?: Error) => {
          if (current.current?.worker !== worker) return;
          clearTimeout(current.current.timer);
          current.current = null;
          worker.terminate();
          setBusy(false);
          if (error) reject(error);
          else if (answer) resolve(answer);
        };
        current.current = { worker, reject };
        if (request.type === 'probe')
          current.current.timer = setTimeout(
            () =>
              finish(
                undefined,
                new Error('Reading this file took too long. Choose a smaller clip.'),
              ),
            30_000,
          );
        worker.onmessage = ({ data }: MessageEvent<AnimationResponse>) => {
          if (current.current?.worker !== worker) return;
          if (data.type === 'progress') setProgress(data);
          else if (data.type === 'error') finish(undefined, new Error(data.message));
          else finish(data);
        };
        worker.onerror = () =>
          finish(
            undefined,
            new Error('The animation worker stopped. Check the Wasm build and try again.'),
          );
        worker.postMessage(request);
      });
    },
    [stop],
  );
  return { run, stop, busy, progress };
}
