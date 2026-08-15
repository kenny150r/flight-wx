export function decodePolarData(polarData) {
  if (!polarData || polarData.data == null) {
    throw new Error("Radar payload missing encoded gate data");
  }
  let values;
  if (polarData.data instanceof Uint8Array) {
    values = polarData.data;
  } else if (Array.isArray(polarData.data)) {
    values = Uint8Array.from(polarData.data);
  } else {
    throw new Error("Radar payload missing encoded gate data");
  }
  return {
    values,
    numAz: polarData.azimuths.length,
    numGates: polarData.num_gates,
    azimuthStartDeg: polarData.azimuths[0] || 0,
  };
}
