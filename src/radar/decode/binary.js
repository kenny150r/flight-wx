import { gunzipSync } from "fflate";

export class BinaryReader {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }

  get length() {
    return this.bytes.byteLength;
  }

  getPos() {
    return this.offset;
  }

  seek(pos) {
    this.offset = pos;
  }

  remaining() {
    return this.length - this.offset;
  }

  readBytes(n) {
    const slice = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  readString(n) {
    const bytes = this.readBytes(n);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  readInt8() {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readUint8() {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readInt16() {
    const v = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return v;
  }

  readUint16() {
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  readInt32() {
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readUint32() {
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }
}

export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function looksLikeGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function maybeGunzipSync(bytes) {
  if (!looksLikeGzip(bytes)) return bytes;
  return gunzipSync(bytes);
}

export async function maybeGunzip(bytes) {
  if (!looksLikeGzip(bytes)) return bytes;
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // fall through to fflate
    }
  }
  return maybeGunzipSync(bytes);
}
