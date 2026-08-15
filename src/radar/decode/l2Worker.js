const volumeCache = { key: "", radar: null };

function postProgress(id, text, extra = {}) {
  self.postMessage({ id, progress: { phase: "decode", text, ...extra } });
}

function ownedBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) return new Uint8Array(bytes);
  if (bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength) return bytes;
  return bytes.slice();
}

self.postMessage({ ready: true });

self.onmessage = async (event) => {
  const { id, bytes, options, warmup } = event.data || {};
  try {
    if (warmup) {
      await import("nexrad-level-2-data");
      await import("./l2.js");
      self.postMessage({ id, ok: true, payload: { warm: true } });
      return;
    }

    postProgress(id, "Starting decoder…");
    const { maybeGunzip } = await import("./binary.js");

    const cacheKey = options?.s3Key || `${options?.dateClean || ""}_${options?.timeClean || ""}`;
    let radar = cacheKey && volumeCache.key === cacheKey ? volumeCache.radar : null;
    const t0 = performance.now();
    if (!radar) {
      postProgress(id, "Unpacking volume…");
      const unzipped = ownedBytes(await maybeGunzip(bytes));
      const tGunzip = performance.now();

      const { findL2BzipBlocks } = await import("./l2Blocks.js");
      const found = findL2BzipBlocks(unzipped);
      let inflated = unzipped;
      if (found) {
        const { inflateL2Volume } = await import("./l2Inflate.js");
        inflated = ownedBytes(await inflateL2Volume(unzipped, {
          onProgress: (done, total) => {
            const pct = total ? Math.round((done / total) * 100) : 0;
            postProgress(id, `Decompressing ${done}/${total} chunks… ${pct}%`, { loaded: done, total });
          },
        }));
      }
      const tInflate = performance.now();
      postProgress(id, "Loading parser…");
      const { default: Level2Radar } = await import("nexrad-level-2-data");
      postProgress(id, "Parsing sweeps…");
      radar = new Level2Radar(inflated, { logger: false });
      const tParse = performance.now();
      volumeCache.key = cacheKey;
      volumeCache.radar = radar;
      console.info("[l2]", {
        gunzipMs: Math.round(tGunzip - t0),
        inflateMs: Math.round(tInflate - tGunzip),
        parseMs: Math.round(tParse - tInflate),
        bytes: bytes?.byteLength,
        inflated: inflated.byteLength,
        bzipBlocks: found?.blocks?.length || 0,
      });
    } else {
      postProgress(id, "Using cached volume…");
    }
    postProgress(id, "Extracting sweep…");
    const { decodeL2Volume } = await import("./l2.js");
    const payload = decodeL2Volume(bytes, { ...options, radar });
    console.info("[l2] extractMs", Math.round(performance.now() - t0));
    const transfers = [];
    const collect = (frame) => {
      if (frame?.data instanceof Uint8Array) transfers.push(frame.data.buffer);
    };
    if (payload?.frames) payload.frames.forEach(collect);
    else collect(payload);
    self.postMessage({ id, ok: true, payload }, transfers);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
