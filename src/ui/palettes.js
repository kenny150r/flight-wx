export const RADAR_PALETTE_BINS = 128;
export const RADAR_PALETTE_SIZE = RADAR_PALETTE_BINS + 1;

function rgbaString(r, g, b, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildInterpolatedPalette(anchorStops, bins) {
  const out = [null];
  for (let i = 0; i < bins; i++) {
    const x = bins === 1 ? 0 : i / (bins - 1);
    let left = anchorStops[0];
    let right = anchorStops[anchorStops.length - 1];
    for (let j = 0; j < anchorStops.length - 1; j++) {
      const a = anchorStops[j];
      const b = anchorStops[j + 1];
      if (x >= a.pos && x <= b.pos) {
        left = a;
        right = b;
        break;
      }
    }
    const span = Math.max(1e-9, right.pos - left.pos);
    const t = Math.max(0, Math.min(1, (x - left.pos) / span));
    out.push(rgbaString(
      lerp(left.r, right.r, t),
      lerp(left.g, right.g, t),
      lerp(left.b, right.b, t),
      lerp(left.a, right.a, t),
    ));
  }
  return out;
}

export const POLAR_REF_COLORS = buildInterpolatedPalette([
  { pos: 0.00, r: 0, g: 0, b: 0, a: 0.00 },
  { pos: 0.08, r: 74, g: 255, b: 255, a: 0.04 },
  { pos: 0.16, r: 0, g: 191, b: 255, a: 0.23 },
  { pos: 0.24, r: 0, g: 119, b: 255, a: 0.40 },
  { pos: 0.36, r: 0, g: 200, b: 75, a: 0.78 },
  { pos: 0.46, r: 130, g: 220, b: 0, a: 0.88 },
  { pos: 0.56, r: 255, g: 230, b: 0, a: 0.90 },
  { pos: 0.66, r: 255, g: 140, b: 0, a: 0.94 },
  { pos: 0.78, r: 235, g: 0, b: 0, a: 0.97 },
  { pos: 0.88, r: 210, g: 0, b: 160, a: 0.99 },
  { pos: 1.00, r: 255, g: 255, b: 255, a: 1.00 },
], RADAR_PALETTE_BINS);

export const POLAR_VEL_COLORS = buildInterpolatedPalette([
  { pos: 0.00, r: 0, g: 255, b: 0, a: 0.98 },
  { pos: 0.10, r: 0, g: 225, b: 0, a: 0.96 },
  { pos: 0.20, r: 0, g: 190, b: 0, a: 0.93 },
  { pos: 0.30, r: 0, g: 145, b: 0, a: 0.89 },
  { pos: 0.40, r: 32, g: 108, b: 32, a: 0.84 },
  { pos: 0.50, r: 96, g: 96, b: 96, a: 0.38 },
  { pos: 0.60, r: 128, g: 48, b: 48, a: 0.84 },
  { pos: 0.70, r: 168, g: 24, b: 24, a: 0.89 },
  { pos: 0.80, r: 210, g: 0, b: 0, a: 0.93 },
  { pos: 0.90, r: 240, g: 0, b: 0, a: 0.96 },
  { pos: 1.00, r: 255, g: 100, b: 100, a: 1.00 },
], RADAR_PALETTE_BINS);

export function getPaletteForProduct(product) {
  return product === "velocity" ? POLAR_VEL_COLORS : POLAR_REF_COLORS;
}

export function parseColorToRgba(color) {
  if (!color) return [0, 0, 0, 0];
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const parts = m[1].split(",").map((p) => p.trim());
  return [
    Math.max(0, Math.min(255, parseFloat(parts[0]) || 0)),
    Math.max(0, Math.min(255, parseFloat(parts[1]) || 0)),
    Math.max(0, Math.min(255, parseFloat(parts[2]) || 0)),
    (parts.length > 3 ? Math.max(0, Math.min(1, parseFloat(parts[3]) || 0)) : 1) * 255,
  ];
}
