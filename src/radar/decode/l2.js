import Level2Radar from "nexrad-level-2-data";
import { altFtToM } from "../../analysis/beam.js";
import { bearingDeg, haversineKm } from "../../analysis/geo.js";
import { sampleFromTiltHits, tiltHitFromSweep } from "../../analysis/sample.js";
import { quantizePolarIndices } from "./quantize.js";

function countFinite(values) {
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) n += 1;
  }
  return n;
}
import {
  buildBounds,
  dedupeLowestSweeps,
  findSweepsForElevation,
  formatTimeParts,
  getLowElevationSweepIndices,
  listAvailableElevations,
  localTimeFor,
  parseScanKey,
  pickBestSweepByValidity,
} from "./sweeps.js";

const PRODUCT_GETTERS = {
  reflectivity: "getHighresReflectivity",
  velocity: "getHighresVelocity",
  spectrum_width: "getHighresSpectrum",
  differential_reflectivity: "getHighresDiffReflectivity",
  correlation_coefficient: "getHighresCorrelationCoefficient",
};

function sweepTimeMs(header) {
  const julian = header?.julian_date;
  const ms = header?.mseconds;
  if (!Number.isFinite(julian) || !Number.isFinite(ms)) return null;
  return (julian - 1) * 86400000 + ms;
}

export function siteCoords(radar, station) {
  try {
    const elevs = radar.listElevations();
    if (elevs.length) {
      radar.setElevation(elevs[0]);
      const header = radar.getHeader(0);
      const lat = header?.volume?.lat ?? header?.volume?.latitude;
      const lon = header?.volume?.lon ?? header?.volume?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lon) && !(Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6)) {
        return { lat, lon };
      }
    }
  } catch {
    // fall through to station coords
  }
  return { lat: station.lat, lon: station.lon };
}

export function extractSweepMoment(radar, elevationNumber, product) {
  radar.setElevation(elevationNumber);
  const getter = PRODUCT_GETTERS[product];
  if (!getter || typeof radar[getter] !== "function") {
    throw new Error(`${product} data not available in this scan`);
  }
  let rays;
  try {
    rays = radar[getter]();
  } catch {
    throw new Error(`${product} data not available in this scan`);
  }
  if (!Array.isArray(rays) || !rays.length) {
    throw new Error(`${product} data not available in this scan`);
  }
  const azimuths = radar.getAzimuth();
  const headers = radar.getHeader();
  const first = rays.find((r) => r && Array.isArray(r.moment_data) && r.moment_data.length) || rays[0];
  const numGates = first.gate_count || first.moment_data?.length || 0;
  const rawStart = Number(first.first_gate) || 0;
  const rawStep = Number(first.gate_size) || 0.25;
  // Message 31 first_gate/gate_size are kilometers in nexrad-level-2-data.
  const rangeStart = rawStep < 10 ? rawStart * 1000 : rawStart;
  const rangeStep = rawStep < 10 ? rawStep * 1000 : rawStep;
  const values = new Float32Array(rays.length * numGates);
  values.fill(Number.NaN);
  for (let az = 0; az < rays.length; az++) {
    const moment = rays[az]?.moment_data;
    if (!moment) continue;
    const offset = az * numGates;
    for (let g = 0; g < numGates && g < moment.length; g++) {
      const v = moment[g];
      values[offset + g] = Number.isFinite(v) ? v : Number.NaN;
    }
  }
  const pairs = azimuths.map((az, i) => ({ az, i }));
  pairs.sort((a, b) => a.az - b.az);
  const sortedAz = pairs.map((p) => p.az);
  const sorted = new Float32Array(values.length);
  for (let out = 0; out < pairs.length; out++) {
    const src = pairs[out].i * numGates;
    sorted.set(values.subarray(src, src + numGates), out * numGates);
  }
  const header0 = Array.isArray(headers) ? headers[0] : headers;
  return {
    azimuths: sortedAz,
    values: sorted,
    numGates,
    rangeStart,
    rangeStep,
    elevation: Number(header0?.elevation_angle) || 0,
    timestampMs: sweepTimeMs(header0),
    validCount: countFinite(sorted),
  };
}

function collectSweepMeta(radar) {
  const elevNums = radar.listElevations();
  return elevNums.map((num) => {
    try {
      radar.setElevation(num);
      const header = radar.getHeader(0);
      const elevation = Number(header?.elevation_angle) || 0;
      return {
        elevationNumber: num,
        elevation,
        timestampMs: sweepTimeMs(header),
        validCount: 1,
        extracted: null,
      };
    } catch {
      return {
        elevationNumber: num,
        elevation: NaN,
        timestampMs: null,
        validCount: 0,
        extracted: null,
      };
    }
  });
}

function extractNeededSweeps(radar, sweeps, product, indices) {
  const needed = new Set(indices);
  for (const i of needed) {
    const sweep = sweeps[i];
    if (!sweep) continue;
    try {
      const extracted = extractSweepMoment(radar, sweep.elevationNumber, product);
      sweep.extracted = extracted;
      sweep.elevation = extracted.elevation;
      sweep.timestampMs = extracted.timestampMs;
      sweep.validCount = extracted.validCount;
    } catch {
      sweep.extracted = null;
      sweep.validCount = 0;
    }
  }
  return sweeps;
}

function frameFromSweep(sweep, ctx) {
  const { extracted } = sweep;
  const color = quantizePolarIndices(extracted.values, ctx.product);
  const maxRangeM = extracted.rangeStart + extracted.numGates * extracted.rangeStep;
  const maxRangeKm = maxRangeM / 1000;
  const sweepDt = extracted.timestampMs != null ? new Date(extracted.timestampMs) : ctx.volumeDt;
  const time = sweepDt ? formatTimeParts(sweepDt) : ctx.volumeTime;
  const date = sweepDt
    ? `${sweepDt.getUTCFullYear()}${String(sweepDt.getUTCMonth() + 1).padStart(2, "0")}${String(sweepDt.getUTCDate()).padStart(2, "0")}`
    : ctx.dateClean;
  const local = localTimeFor(sweepDt || ctx.volumeDt, ctx.station.timezone);
  return {
    station: ctx.station.id,
    date,
    time,
    ...local,
    product: ctx.product,
    field: ctx.product,
    elevation: Math.round(extracted.elevation * 10) / 10,
    max_range_km: Math.round(maxRangeKm * 10) / 10,
    lat: ctx.lat,
    lon: ctx.lon,
    bounds: buildBounds(ctx.lat, ctx.lon, maxRangeKm),
    azimuths: extracted.azimuths,
    num_azimuths: extracted.azimuths.length,
    range_start_m: extracted.rangeStart,
    range_step_m: extracted.rangeStep,
    num_gates: extracted.numGates,
    data: color,
  };
}

export function decodeL2Volume(bytes, options) {
  const {
    station,
    dateClean,
    timeClean,
    product = "reflectivity",
    elevation = null,
    includeSails = false,
    s3Key = "",
    radar: existingRadar = null,
  } = options;
  const radar = existingRadar || new Level2Radar(bytes, { logger: false });
  const { lat, lon } = siteCoords(radar, station);
  const parsed = parseScanKey(s3Key || `${station.id}${dateClean}_${timeClean}`);
  const volumeTime = parsed.time
    ? `${parsed.time.slice(0, 2)}:${parsed.time.slice(2, 4)}:${parsed.time.slice(4, 6)}`
    : `${timeClean.slice(0, 2)}:${timeClean.slice(2, 4)}:${timeClean.slice(4, 6)}`;
  const volumeDt = new Date(Date.UTC(
    parseInt(dateClean.slice(0, 4), 10),
    parseInt(dateClean.slice(4, 6), 10) - 1,
    parseInt(dateClean.slice(6, 8), 10),
    parseInt(timeClean.slice(0, 2), 10),
    parseInt(timeClean.slice(2, 4), 10),
    parseInt(timeClean.slice(4, 6), 10) || 0,
  ));
  const sweeps = collectSweepMeta(radar);
  const available = listAvailableElevations(sweeps);
  const ctx = { station, product, lat, lon, dateClean, volumeTime, volumeDt };

  let indices;
  let selectedElevation = null;
  if (elevation != null) {
    const found = findSweepsForElevation(sweeps, elevation);
    selectedElevation = found.selected;
    indices = found.indices;
  } else if (includeSails) {
    indices = getLowElevationSweepIndices(sweeps);
    if (indices.length) selectedElevation = sweeps[indices[0]].elevation;
  } else {
    const low = getLowElevationSweepIndices(sweeps);
    indices = low.length ? [low[0]] : sweeps.map((_, i) => i).slice(0, 1);
    selectedElevation = sweeps[indices[0]]?.elevation ?? null;
  }

  extractNeededSweeps(radar, sweeps, product, indices);
  const usable = sweeps.filter((s) => s.extracted);
  if (!usable.length) {
    throw new Error(`${product} data not available in this scan`);
  }

  if (includeSails) {
    indices = dedupeLowestSweeps(usable, usable.map((_, i) => i)).filter((i) => usable[i].validCount > 0);
    if (!indices.length) {
      indices = [pickBestSweepByValidity(usable, usable.map((_, i) => i))];
    }
    const frames = indices.map((i) => frameFromSweep(usable[i], ctx));
    return {
      frames,
      available_elevations: available,
      selected_elevation: selectedElevation != null ? Math.round(selectedElevation * 10) / 10 : null,
    };
  }

  const best = pickBestSweepByValidity(usable, usable.map((_, i) => i));
  const frame = frameFromSweep(usable[best], ctx);
  frame.available_elevations = available;
  frame.selected_elevation = selectedElevation != null
    ? Math.round(selectedElevation * 10) / 10
    : frame.elevation;
  return frame;
}

function radarAltMFromHeader(header) {
  const raw = header?.volume?.height ?? header?.volume?.alt ?? header?.volume?.elevation;
  if (!Number.isFinite(raw)) return 300;
  return raw > 5000 ? raw * 0.3048 : raw;
}

export function extractPhysicalSweeps(radar, station, products = ["reflectivity", "velocity"]) {
  const { lat, lon } = siteCoords(radar, station);
  const elevNums = radar.listElevations();
  let altM = 300;
  const sweeps = [];
  for (const num of elevNums) {
    const extracted = {};
    let elevation = NaN;
    let timestampMs = null;
    for (const product of products) {
      try {
        const moment = extractSweepMoment(radar, num, product);
        extracted[product] = {
          azimuths: moment.azimuths,
          values: moment.values,
          numGates: moment.numGates,
          rangeStart: moment.rangeStart,
          rangeStep: moment.rangeStep,
          elevation: moment.elevation,
          timestampMs: moment.timestampMs,
        };
        elevation = moment.elevation;
        timestampMs = moment.timestampMs;
      } catch {
        // product missing on this tilt
      }
    }
    if (!extracted.reflectivity && !extracted.velocity) continue;
    try {
      radar.setElevation(num);
      const header = radar.getHeader(0);
      altM = radarAltMFromHeader(header);
    } catch {
      // keep previous alt
    }
    sweeps.push({
      elevationNumber: num,
      elevation,
      timestampMs,
      reflectivity: extracted.reflectivity || null,
      velocity: extracted.velocity || null,
    });
  }
  return { lat, lon, altM, sweeps };
}

export function samplePhysicalVolume(radar, station, points, products = ["reflectivity", "velocity"]) {
  const { lat, lon } = siteCoords(radar, station);
  const elevNums = radar.listElevations();
  let altM = 300;
  const acc = (points || []).map((point) => {
    const rangeKm = haversineKm(lat, lon, point.lat, point.lon);
    return {
      point,
      rangeKm,
      azDeg: bearingDeg(lat, lon, point.lat, point.lon),
      aircraftAltM: altFtToM(point.altFt || 0),
      hits: [],
    };
  });
  for (const num of elevNums) {
    const extracted = {};
    let elevation = NaN;
    for (const product of products) {
      try {
        const moment = extractSweepMoment(radar, num, product);
        extracted[product] = {
          azimuths: moment.azimuths,
          values: moment.values,
          numGates: moment.numGates,
          rangeStart: moment.rangeStart,
          rangeStep: moment.rangeStep,
          elevation: moment.elevation,
          timestampMs: moment.timestampMs,
        };
        elevation = moment.elevation;
      } catch {
        // product missing on this tilt
      }
    }
    if (!extracted.reflectivity && !extracted.velocity) continue;
    try {
      radar.setElevation(num);
      altM = radarAltMFromHeader(radar.getHeader(0));
    } catch {
      // keep previous alt
    }
    const sweep = {
      elevation,
      reflectivity: extracted.reflectivity || null,
      velocity: extracted.velocity || null,
    };
    for (const item of acc) {
      item.hits.push(tiltHitFromSweep(sweep, item.azDeg, item.rangeKm * 1000, item.aircraftAltM, altM));
    }
  }
  return {
    lat,
    lon,
    altM,
    samples: acc.map((item) => sampleFromTiltHits(item.point, item.hits, {
      stationId: station?.id || null,
      rangeKm: item.rangeKm,
      azDeg: item.azDeg,
    })),
  };
}
