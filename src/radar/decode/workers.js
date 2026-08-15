let sampleWorker = null;
let nextId = 1;
const pending = new Map();
const DECODE_TIMEOUT_MS = 180000;

function bindWorker(worker) {
  worker.onmessage = (event) => {
    const { id, ok, payload, error, progress } = event.data || {};
    if (id == null) return;
    const waiter = pending.get(id);
    if (!waiter) return;
    if (progress) {
      waiter.onProgress?.(progress);
      return;
    }
    pending.delete(id);
    if (ok) waiter.resolve(payload);
    else waiter.reject(new Error(error || "Worker failed"));
  };
  worker.onerror = (err) => {
    const error = err instanceof Error ? err : new Error(err?.message || "Worker failed");
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
}

function getSampleWorker() {
  if (!sampleWorker) {
    sampleWorker = new Worker(new URL("./sampleWorker.js", import.meta.url), { type: "module" });
    bindWorker(sampleWorker);
  }
  return sampleWorker;
}

function callWorker(worker, message, transfer = [], onProgress) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Radar decode timed out. Try refreshing."));
    }, DECODE_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
      onProgress,
    });
    worker.postMessage({ ...message, id }, transfer);
  });
}

function transferBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    const copy = new Uint8Array(bytes);
    return { bytes: copy, transfer: [copy.buffer] };
  }
  if (bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength) {
    return { bytes, transfer: [bytes.buffer] };
  }
  const copy = bytes.slice();
  return { bytes: copy, transfer: [copy.buffer] };
}

export function sampleL2InWorker(bytes, options, onProgress) {
  const packed = transferBytes(bytes);
  return callWorker(getSampleWorker(), { bytes: packed.bytes, options }, packed.transfer, onProgress);
}
