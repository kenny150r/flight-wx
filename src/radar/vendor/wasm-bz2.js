import { decompress as jsDecompress } from "./bz2.js";

const MAX_DEST_SIZE = 64 * 1024 * 1024;

function wasmDecompress(module, src, destSize) {
  const srcBuf = module._malloc(src.byteLength);
  const dstBuf = module._malloc(destSize);
  module.HEAPU8.subarray(srcBuf, srcBuf + src.byteLength).set(src);
  try {
    const { code, error, buffer } = module.decompress(dstBuf, destSize, srcBuf, src.byteLength, 0);
    if (code !== 0 || buffer == undefined) {
      throw new Error(`BZ2 decompression failed: ${code} (${error ?? "unknown"})`);
    }
    return new Uint8Array(buffer);
  } finally {
    module._free(srcBuf);
    module._free(dstBuf);
  }
}

export default class Bzip2 {
  constructor(impl) {
    this.impl = impl;
  }

  static async init() {
    try {
      if (!globalThis.__BZ2_WASM_URL) {
        const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
        globalThis.__BZ2_WASM_URL = `${base}bz2.wasm`;
      }
      const glue = await import("./wasm-bz2-glue.js");
      const factory = glue.default || glue;
      const module = await factory();
      if (module && typeof module.decompress === "function") {
        return new Bzip2({ type: "wasm", module });
      }
    } catch {
      // fall through to the JS decoder
    }
    return new Bzip2({ type: "js" });
  }

  decompress(src, destSize, _opts) {
    const input = src instanceof Uint8Array ? src : new Uint8Array(src);
    if (this.impl.type === "js") {
      const out = jsDecompress(input);
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    }
    let size = destSize || input.length * 6;
    for (;;) {
      try {
        return wasmDecompress(this.impl.module, input, size);
      } catch (err) {
        const message = String(err?.message || err);
        if (size >= MAX_DEST_SIZE || !message.includes("BZ_OUTBUFF_FULL")) throw err;
        size = Math.min(size * 4, MAX_DEST_SIZE);
      }
    }
  }
}
