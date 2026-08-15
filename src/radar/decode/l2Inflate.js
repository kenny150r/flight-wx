import Bzip2 from "../vendor/wasm-bz2.js";
import { assembleL2Volume, findL2BzipBlocks } from "./l2Blocks.js";

const MAX_WORKERS = 3;

function poolSize(blockCount) {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(MAX_WORKERS, cores, blockCount));
}

async function inflateSequential(bytes, found, onProgress) {
  const bz2 = await Bzip2.init();
  const parts = [];
  for (let i = 0; i < found.blocks.length; i++) {
    const block = found.blocks[i];
    parts.push(bz2.decompress(bytes.subarray(block.offset, block.offset + block.size), block.size * 6));
    onProgress?.(i + 1, found.blocks.length);
  }
  return assembleL2Volume(bytes, found.headerSize, parts);
}

async function inflatePooled(bytes, found, onProgress) {
  const workers = Array.from({ length: poolSize(found.blocks.length) }, () => (
    new Worker(new URL("./bz2BlockWorker.js", import.meta.url), { type: "module" })
  ));
  const parts = new Array(found.blocks.length);
  let next = 0;
  let done = 0;
  let failed = null;

  await new Promise((resolve, reject) => {
    const finish = (err) => {
      for (const worker of workers) worker.terminate();
      if (err) reject(err);
      else resolve();
    };

    const assign = (worker) => {
      if (failed) return;
      if (next >= found.blocks.length) {
        if (done >= found.blocks.length) finish();
        return;
      }
      const index = next;
      next += 1;
      const block = found.blocks[index];
      const chunk = bytes.slice(block.offset, block.offset + block.size);
      worker.postMessage({ id: index, chunks: [{ index, bytes: chunk }] }, [chunk.buffer]);
    };

    for (const worker of workers) {
      worker.onmessage = (event) => {
        const { ok, results, error } = event.data || {};
        if (!ok) {
          failed = new Error(error || "bzip worker failed");
          finish(failed);
          return;
        }
        for (const item of results) parts[item.index] = item.bytes;
        done += results.length;
        onProgress?.(done, found.blocks.length);
        assign(worker);
      };
      worker.onerror = (err) => {
        failed = err instanceof Error ? err : new Error(String(err?.message || err));
        finish(failed);
      };
      assign(worker);
    }
  });

  return assembleL2Volume(bytes, found.headerSize, parts);
}

export async function inflateL2Volume(bytes, { onProgress } = {}) {
  const found = findL2BzipBlocks(bytes);
  if (!found) return bytes;
  onProgress?.(0, found.blocks.length);
  if (typeof Worker === "undefined" || found.blocks.length < 2) {
    return inflateSequential(bytes, found, onProgress);
  }
  try {
    return await inflatePooled(bytes, found, onProgress);
  } catch {
    return inflateSequential(bytes, found, onProgress);
  }
}
