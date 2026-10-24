import { useEffect, useRef, useState } from 'react';
import { outputSize } from './media';
import type { Settings, SourceImage, WorkerRequest, WorkerResponse } from './types';

export type ProcessedImage = Extract<WorkerResponse, { type: 'result' }>;

export function useEngine(source: SourceImage | null, settings: Settings) {
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProcessedImage | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const desiredId = useRef(0);
  const sourceReady = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef<Extract<WorkerRequest, { type: 'process' }> | null>(null);
  const dispatch = useRef(() => {});

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    dispatch.current = () => {
      if (!sourceReady.current || inFlight.current || !pending.current) return;
      const request = pending.current;
      pending.current = null;
      inFlight.current = true;
      worker.postMessage(request);
    };
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'ready') {
        setReady(true);
        return;
      }
      if (data.type === 'source-ready') {
        if (data.generation === generation.current) {
          sourceReady.current = true;
          dispatch.current();
        }
        return;
      }
      if (data.type === 'result') {
        inFlight.current = false;
        if (data.generation === generation.current && data.id === desiredId.current) {
          setResult(data);
          setProcessing(false);
          setError('');
        }
        dispatch.current();
        return;
      }
      // A source-loading error has no id. A processing error belongs to a
      // particular request and must not overwrite a newer image's status.
      if (data.id !== undefined) inFlight.current = false;
      if (
        data.generation === undefined ||
        (data.generation === generation.current &&
          (data.id === undefined || data.id === desiredId.current))
      ) {
        setError(data.message);
        setProcessing(false);
      }
      dispatch.current();
    };
    worker.onerror = () => {
      setError('The image engine stopped unexpectedly. Reload the page to restart it.');
      setProcessing(false);
      setReady(false);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!source || !ready || !workerRef.current) return;
    generation.current += 1;
    sourceReady.current = false;
    pending.current = null;
    setResult(null);
    setError('');
    const pixels = source.canvas.getContext('2d')!.getImageData(0, 0, source.width, source.height);
    const rgba = pixels.data.buffer as ArrayBuffer;
    const request: WorkerRequest = {
      type: 'source',
      generation: generation.current,
      width: source.width,
      height: source.height,
      rgba,
    };
    workerRef.current.postMessage(request, [rgba]);
  }, [source, ready]);

  useEffect(() => {
    if (!source || !ready) return;
    const id = ++desiredId.current;
    pending.current = null;
    setProcessing(true);
    setError('');
    // Only one request runs at a time. Rapid control changes replace the queued
    // request; a generation/id check prevents stale results being displayed.
    const timer = setTimeout(() => {
      const { width, height } = outputSize(source, settings.targetWidth);
      pending.current = {
        type: 'process',
        generation: generation.current,
        id,
        width,
        height,
        settings,
      };
      dispatch.current();
    }, 120);
    return () => clearTimeout(timer);
  }, [source, ready, settings]);

  return { ready, processing, error, result };
}
