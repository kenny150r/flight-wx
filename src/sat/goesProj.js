// GOES-R ABI fixed-grid navigation from PUG Vol. 3 §5.1.2.8.

export const GRS80 = {
  semiMajor: 6378137,
  semiMinor: 6356752.31414,
  eccentricity: 0.0818191910435,
  perspectiveHeight: 35786023,
};

export function goesNav(proj = {}) {
  const rEq = Number(proj.semi_major_axis) || GRS80.semiMajor;
  const rPol = Number(proj.semi_minor_axis) || GRS80.semiMinor;
  const hSat = Number(proj.perspective_point_height) || GRS80.perspectiveHeight;
  const lon0Deg = Number(proj.longitude_of_projection_origin);
  const lon0 = Number.isFinite(lon0Deg) ? lon0Deg * (Math.PI / 180) : -75 * (Math.PI / 180);
  const H = hSat + rEq;
  const rEq2 = rEq * rEq;
  const rPol2 = rPol * rPol;
  const invFlat = rEq2 / rPol2;
  const e2 = (rEq2 - rPol2) / rEq2;

  function scanToLonLat(x, y) {
    const sinX = Math.sin(x);
    const cosX = Math.cos(x);
    const sinY = Math.sin(y);
    const cosY = Math.cos(y);
    const a = sinX * sinX + cosX * cosX * (cosY * cosY + invFlat * sinY * sinY);
    const b = -2 * H * cosX * cosY;
    const c = H * H - rEq2;
    const disc = b * b - 4 * a * c;
    if (!(a > 0) || disc < 0) return null;
    const rs = (-b - Math.sqrt(disc)) / (2 * a);
    const sx = rs * cosX * cosY;
    const sy = -rs * sinX;
    const sz = rs * cosX * sinY;
    const ecefX = H - sx;
    const hyp = Math.hypot(ecefX, sy);
    if (!(hyp > 0)) return null;
    const lat = Math.atan((invFlat * sz) / hyp);
    const lon = lon0 - Math.atan(sy / ecefX);
    return { lon: lon * (180 / Math.PI), lat: lat * (180 / Math.PI), sx, sy, sz, rs, a, b, c };
  }

  function lonLatToScan(lonDeg, latDeg) {
    const lon = lonDeg * (Math.PI / 180);
    const lat = latDeg * (Math.PI / 180);
    const latc = Math.atan((rPol2 / rEq2) * Math.tan(lat));
    const rc = rPol / Math.sqrt(1 - e2 * Math.cos(latc) * Math.cos(latc));
    const sx = H - rc * Math.cos(latc) * Math.cos(lon - lon0);
    const sy = -rc * Math.cos(latc) * Math.sin(lon - lon0);
    const sz = rc * Math.sin(latc);
    if (H * (H - sx) < sy * sy + invFlat * sz * sz) return null;
    const r = Math.hypot(sx, sy, sz);
    if (!(r > 0) || !(sx > 0)) return null;
    return { x: Math.asin(-sy / r), y: Math.atan(sz / sx), sx, sy, sz, rc, latc };
  }

  return { H, lon0, rEq, rPol, scanToLonLat, lonLatToScan };
}

export function outputGrid(bbox, deg, maxPixels = 4_000_000) {
  const west = bbox.west;
  const east = bbox.east;
  const south = bbox.south;
  const north = bbox.north;
  if (!(east > west) || !(north > south) || !(deg > 0)) return null;
  let d = deg;
  let width = Math.max(1, Math.round((east - west) / d));
  let height = Math.max(1, Math.round((north - south) / d));
  if (width * height > maxPixels) {
    d *= Math.sqrt((width * height) / maxPixels);
    width = Math.max(1, Math.round((east - west) / d));
    height = Math.max(1, Math.round((north - south) / d));
  }
  return {
    west,
    east,
    south,
    north,
    width,
    height,
    dLon: (east - west) / width,
    dLat: (north - south) / height,
  };
}

export function makeGoesLut(nav, grid, x0, dx, nx, y0, dy, ny) {
  const idx = new Int32Array(grid.width * grid.height);
  idx.fill(-1);
  for (let row = 0; row < grid.height; row++) {
    const lat = grid.north - (row + 0.5) * grid.dLat;
    for (let col = 0; col < grid.width; col++) {
      const lon = grid.west + (col + 0.5) * grid.dLon;
      const scan = nav.lonLatToScan(lon, lat);
      if (!scan) continue;
      const si = Math.round((scan.x - x0) / dx);
      const sj = Math.round((scan.y - y0) / dy);
      if (si < 0 || sj < 0 || si >= nx || sj >= ny) continue;
      idx[row * grid.width + col] = sj * nx + si;
    }
  }
  return idx;
}

export function samplePacked(raw, lut, scale, offset, fill) {
  const values = new Float32Array(lut.length);
  for (let i = 0; i < lut.length; i++) {
    const src = lut[i];
    if (src < 0) {
      values[i] = NaN;
      continue;
    }
    const packed = raw[src];
    if (packed === fill || packed < 0) {
      values[i] = NaN;
      continue;
    }
    values[i] = packed * scale + offset;
  }
  return values;
}
