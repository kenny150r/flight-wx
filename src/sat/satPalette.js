// AWIPS-style IR enhancement. IEM archive TIFFs are 8-bit grayscale (0 = missing);
// higher values are treated as colder cloud tops. ABI C13 is Kelvin.
export function irColor(v) {
  if (v < 100) {
    const g = 40 + Math.round((v / 100) * 140);
    return [g, g, g];
  }
  if (v < 130) {
    const t = (v - 100) / 30;
    return [0, Math.round(160 + t * 95), Math.round(255 - t * 40)];
  }
  if (v < 160) {
    const t = (v - 130) / 30;
    return [Math.round(t * 255), 255, Math.round((1 - t) * 180)];
  }
  if (v < 190) {
    const t = (v - 160) / 30;
    return [255, Math.round(255 - t * 180), 0];
  }
  if (v < 220) {
    const t = (v - 190) / 30;
    return [255, Math.round(40 * (1 - t)), Math.round(t * 200)];
  }
  const t = (v - 220) / 35;
  return [255, Math.round(180 * t), 255];
}

export function irColorC(tc) {
  const v = ((40 - tc) / 120) * 255;
  return irColor(Math.max(1, Math.min(255, v)));
}

export function visGray(reflectance) {
  const g = Math.round(Math.sqrt(Math.min(1, Math.max(0, reflectance))) * 255);
  return g;
}

export function satRgba(values, product, rgba, { units } = {}) {
  const ir = product === "ir";
  const kelvin = units === "kelvin";
  const reflectance = units === "reflectance";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const o = i * 4;
    const missing = kelvin || reflectance ? !Number.isFinite(v) : !v;
    if (missing) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 0;
      continue;
    }
    if (kelvin) {
      const c = irColorC(v - 273.15);
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
    } else if (reflectance) {
      const g = visGray(v);
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
    } else if (ir) {
      const c = irColor(v);
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
    }
    rgba[o + 3] = 255;
  }
  return rgba;
}
