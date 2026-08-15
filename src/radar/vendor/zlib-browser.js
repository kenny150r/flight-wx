import { gunzipSync as fflateGunzip } from "fflate";

export function gunzipSync(data) {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data);
  return fflateGunzip(input);
}

export default { gunzipSync };
