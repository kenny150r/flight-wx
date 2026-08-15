import Bzip2 from "../vendor/wasm-bz2.js";

let engine = null;

async function getEngine() {
  if (!engine) engine = await Bzip2.init();
  return engine;
}

self.onmessage = async (event) => {
  const { id, chunks } = event.data || {};
  try {
    const bz2 = await getEngine();
    const results = chunks.map(({ index, bytes }) => ({
      index,
      bytes: bz2.decompress(bytes, bytes.length * 6),
    }));
    const transfers = results
      .map((item) => item.bytes?.buffer)
      .filter((buffer) => buffer instanceof ArrayBuffer);
    self.postMessage({ id, ok: true, results }, transfers);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
