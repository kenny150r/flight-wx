import { RandomAccessFile, BIG_ENDIAN } from "nexrad-level-2-data/src/classes/RandomAccessFile.mjs";
import { maybeGunzipSync } from "../decode/binary.js";

/** Volumes are inflated before parse, so this stays sync and avoids top-level await. */
export default function decompress(raf) {
  const bytes = raf.array;
  if (bytes?.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new RandomAccessFile(maybeGunzipSync(bytes), BIG_ENDIAN);
  }
  return raf;
}
