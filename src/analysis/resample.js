const DEFAULT_STRIDE_SEC = 60;
const ALT_BREAK_FT = 1000;

export function resampleTrack(points, strideSec = DEFAULT_STRIDE_SEC) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.timeMs - b.timeMs);
  const out = [sorted[0]];
  let last = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    const dt = (p.timeMs - last.timeMs) / 1000;
    const dAlt = Math.abs((p.altFt || 0) - (last.altFt || 0));
    const isLast = i === sorted.length - 1;
    if (dt >= strideSec || dAlt >= ALT_BREAK_FT || isLast) {
      if (out[out.length - 1] !== p) out.push(p);
      last = p;
    }
  }
  return out;
}
