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
  const { id, bytes, options } = event.data || {};
  try {
    postProgress(id, "Starting decoder…");
    const { maybeGunzip } = await import("./binary.js");
    const cacheKey = options?.s3Key || `${options?.station?.id || ""}_${options?.dateClean || ""}_${options?.timeClean || ""}`;
    let radar = cacheKey && volumeCache.key === cacheKey ? volumeCache.radar : null;
    if (!radar) {
      postProgress(id, "Unpacking volume…");
      const unzipped = ownedBytes(await maybeGunzip(bytes));
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
      postProgress(id, "Parsing sweeps…");
      const { default: Level2Radar } = await import("nexrad-level-2-data");
      radar = new Level2Radar(inflated, { logger: false });
      volumeCache.key = cacheKey;
      volumeCache.radar = radar;
    }
    postProgress(id, "Sampling flight path…");
    const { samplePhysicalVolume } = await import("./l2.js");
    const { samples } = samplePhysicalVolume(radar, options.station, options.points || []);
    self.postMessage({ id, ok: true, payload: { samples } });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
