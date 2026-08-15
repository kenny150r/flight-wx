export const RADAR_COLOR_BINS = 128;

const KTS_TO_MS = 0.514444;
const VEL_MIN_KTS = -130;
const VEL_MAX_KTS = 130;
const VEL_MIN_MS = VEL_MIN_KTS * KTS_TO_MS;
const VEL_MAX_MS = VEL_MAX_KTS * KTS_TO_MS;
const VEL_SENSITIVITY_GAMMA = 0.61;
const REF_MIN_DBZ = 5;
const REF_MAX_DBZ = 75;
const SW_MIN_MS = 0;
const SW_MAX_MS = 15;
const ZDR_MIN_DB = -2;
const ZDR_MAX_DB = 6;
const CC_MIN = 0.7;
const CC_MAX = 1.0;

export const L3_PRODUCT_SPECS = {
  l3_reflectivity: { code: "N0Q", fallback: ["N0B"], min: -20, max: 75 },
  l3_velocity: { code: "N0U", fallback: ["N0G"], min: -64, max: 64 },
  l3_echo_tops: { code: "EET", min: 5, max: 70 },
  l3_vil: { code: "DVL", min: 0, max: 80 },
  l3_hydrometeor: { code: "N0H", fallback: ["N0S"], categorical: true },
  l3_hybrid_hca: { code: "HHC", categorical: true },
  l3_zdr: { code: "N0X", min: -2, max: 6 },
  l3_cc: { code: "N0C", min: 0.2, max: 1.05 },
  l3_kdp: { code: "N0K", min: -2, max: 10 },
};

const HCA_CLASSES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 140];

function isValidNumber(value) {
  return Number.isFinite(value);
}

export function quantizePolarIndices(values, product) {
  const out = new Uint8Array(values.length);
  if (product === "velocity") {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isValidNumber(v)) continue;
      let scaled = (v - VEL_MIN_MS) / (VEL_MAX_MS - VEL_MIN_MS);
      scaled = Math.min(1, Math.max(0, scaled));
      let signed = scaled * 2 - 1;
      signed = Math.sign(signed) * (Math.abs(signed) ** VEL_SENSITIVITY_GAMMA);
      scaled = (signed + 1) * 0.5;
      out[i] = Math.floor(scaled * (RADAR_COLOR_BINS - 1)) + 1;
    }
    return out;
  }
  if (product === "reflectivity") {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isValidNumber(v)) continue;
      if (v < REF_MIN_DBZ) {
        out[i] = 1;
        continue;
      }
      let scaled = (v - REF_MIN_DBZ) / (REF_MAX_DBZ - REF_MIN_DBZ);
      scaled = Math.min(1, Math.max(0, scaled));
      out[i] = Math.floor(scaled * (RADAR_COLOR_BINS - 2)) + 2;
    }
    return out;
  }

  let minV = 0;
  let maxV = 1;
  if (product === "spectrum_width") {
    minV = SW_MIN_MS;
    maxV = SW_MAX_MS;
  } else if (product === "correlation_coefficient") {
    minV = CC_MIN;
    maxV = CC_MAX;
  } else if (product === "differential_reflectivity") {
    minV = ZDR_MIN_DB;
    maxV = ZDR_MAX_DB;
  }
  const span = maxV - minV || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isValidNumber(v)) continue;
    const scaled = Math.min(1, Math.max(0, (v - minV) / span));
    out[i] = Math.floor(scaled * (RADAR_COLOR_BINS - 1)) + 1;
  }
  return out;
}

export function quantizeL3Data(values, productKey) {
  const spec = L3_PRODUCT_SPECS[productKey];
  if (!spec) return new Uint8Array(values.length);
  if (spec.categorical) return quantizeCategorical(values);

  const out = new Uint8Array(values.length);
  const minV = spec.min;
  const maxV = spec.max;
  const span = maxV - minV || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isValidNumber(v)) continue;
    if (productKey === "l3_velocity") {
      let scaled = (v - minV) / span;
      scaled = Math.min(1, Math.max(0, scaled));
      let signed = scaled * 2 - 1;
      signed = Math.sign(signed) * (Math.abs(signed) ** VEL_SENSITIVITY_GAMMA);
      scaled = (signed + 1) * 0.5;
      out[i] = Math.floor(scaled * (RADAR_COLOR_BINS - 1)) + 1;
    } else {
      const scaled = Math.min(1, Math.max(0, (v - minV) / span));
      out[i] = Math.floor(scaled * (RADAR_COLOR_BINS - 1)) + 1;
    }
  }
  return out;
}

export function quantizeCategorical(values) {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isValidNumber(v)) continue;
    const idx = HCA_CLASSES.indexOf(Math.round(v));
    if (idx >= 0) out[i] = idx + 1;
  }
  return out;
}

export function validGateCount(values) {
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i]) n += 1;
  }
  return n;
}
