import { defaultConcurrency } from "../../analysis/pool.js";
import SampleWorker from "./sampleWorker.js?worker";
import L2Worker from "./l2Worker.js?worker";

const DECODE_TIMEOUT_MS = 180000;
let nextId = 1;
const pending = new Map();

function bindWorker(worker) {
  const mine = new Set();
  worker.trackJob = (id) => mine.add(id);
  worker.untrackJob = (id) => mine.delete(id);
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
    mine.delete(id);
    if (ok) waiter.resolve(payload);
    else waiter.reject(new Error(error || "Worker failed"));
  };
  worker.onerror = (err) => {
    worker.dead = true;
    const error = err instanceof Error ? err : new Error(err?.message || "Worker failed");
    for (const id of mine) {
      const waiter = pending.get(id);
      if (!waiter) continue;
      pending.delete(id);
      waiter.reject(error);
    }
    mine.clear();
  };
}

class WorkerPool {
  constructor(WorkerCtor, size) {
    this.WorkerCtor = WorkerCtor;
    this.size = Math.max(1, size);
    this.workers = [];
    this.idle = [];
    this.waiters = [];
    this.affinity = new Map();
  }

  _spawn() {
    const worker = new this.WorkerCtor();
    bindWorker(worker);
    this.workers.push(worker);
    return worker;
  }

  acquire(key) {
    if (key) {
      const sticky = this.affinity.get(key);
      const idleAt = sticky ? this.idle.indexOf(sticky) : -1;
      if (idleAt >= 0) {
        this.idle.splice(idleAt, 1);
        return Promise.resolve(sticky);
      }
    }
    if (this.idle.length) return Promise.resolve(this.idle.pop());
    if (this.workers.length < this.size) return Promise.resolve(this._spawn());
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(worker, { key, failed } = {}) {
    if (failed || worker.dead) {
      this.workers = this.workers.filter((item) => item !== worker);
      for (const [affinity, bound] of this.affinity) {
        if (bound === worker) this.affinity.delete(affinity);
      }
      try { worker.terminate(); } catch { /* already dead */ }
      if (this.waiters.length) this.waiters.shift()(this._spawn());
      return;
    }
    if (key) this.affinity.set(key, worker);
    if (this.waiters.length) this.waiters.shift()(worker);
    else this.idle.push(worker);
  }
}

const samplePool = new WorkerPool(SampleWorker, defaultConcurrency("decode"));
const l2Pool = new WorkerPool(L2Worker, defaultConcurrency("decode"));

function callWorker(worker, message, transfer = [], onProgress) {
  const id = nextId++;
  worker.trackJob?.(id);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      worker.untrackJob?.(id);
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

async function runInPool(pool, bytes, options, onProgress) {
  const packed = transferBytes(bytes);
  const key = options?.s3Key || "";
  const worker = await pool.acquire(key);
  try {
    const payload = await callWorker(worker, { bytes: packed.bytes, options }, packed.transfer, onProgress);
    pool.release(worker, { key });
    return payload;
  } catch (error) {
    const timedOut = /timed out/i.test(error?.message || "");
    pool.release(worker, { key, failed: timedOut });
    throw error;
  }
}

export function sampleL2InWorker(bytes, options, onProgress) {
  return runInPool(samplePool, bytes, options, onProgress);
}

export function decodeL2InWorker(bytes, options, onProgress) {
  return runInPool(l2Pool, bytes, options, onProgress);
}
