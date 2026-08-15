const FILE_HEADER_SIZE = 24;

function isBzh(bytes, offset) {
  return bytes[offset] === 0x42 && bytes[offset + 1] === 0x5a && bytes[offset + 2] === 0x68;
}

export function findL2BzipBlocks(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let headerSize = 0;
  let pos = 0;
  if (isBzh(bytes, 4)) {
    pos = 0;
  } else if (bytes.length > FILE_HEADER_SIZE + 8 && isBzh(bytes, FILE_HEADER_SIZE + 4)) {
    headerSize = FILE_HEADER_SIZE;
    pos = FILE_HEADER_SIZE;
  } else {
    return null;
  }

  const blocks = [];
  while (pos + 4 < bytes.length) {
    const size = Math.abs(view.getInt32(pos, false));
    pos += 4;
    if (size <= 0 || pos + size > bytes.length || !isBzh(bytes, pos)) break;
    blocks.push({ offset: pos, size });
    pos += size;
  }
  if (!blocks.length) return null;
  return { headerSize, blocks };
}

export function assembleL2Volume(bytes, headerSize, parts) {
  const header = headerSize ? bytes.subarray(0, headerSize) : new Uint8Array(0);
  let total = header.length;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
