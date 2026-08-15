const L2_BUCKET = "unidata-nexrad-level2";
const L3_BUCKET = "unidata-nexrad-level3";
const S3_HOST = (bucket) => `https://${bucket}.s3.amazonaws.com`;

async function fetchDirect(directUrl, signal) {
  return fetch(directUrl, signal ? { signal } : undefined);
}

function xmlTag(xmlText, tag) {
  const match = xmlText.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : "";
}

function parseListXml(xmlText) {
  const contents = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = re.exec(xmlText))) {
    const block = match[1];
    contents.push({
      key: xmlTag(block, "Key"),
      size: parseInt(xmlTag(block, "Size") || "0", 10),
    });
  }
  return {
    contents,
    truncated: xmlTag(xmlText, "IsTruncated") === "true",
    token: xmlTag(xmlText, "NextContinuationToken"),
  };
}

export async function listS3Prefix(bucket, prefix, { signal } = {}) {
  const objects = [];
  let token = "";
  do {
    const params = new URLSearchParams({
      "list-type": "2",
      prefix,
      "max-keys": "1000",
    });
    if (token) params.set("continuation-token", token);
    const query = params.toString();
    const directUrl = `${S3_HOST(bucket)}/?${query}`;
    const resp = await fetchDirect(directUrl, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!resp.ok) {
      throw new Error(`S3 list failed (${resp.status}) for ${prefix}`);
    }
    const xml = await resp.text();
    const page = parseListXml(xml);
    objects.push(...page.contents);
    token = page.truncated ? page.token : "";
  } while (token);
  return objects;
}

export async function getS3Object(bucket, key, { signal, onProgress } = {}) {
  const directUrl = `${S3_HOST(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const resp = await fetchDirect(directUrl, signal);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!resp.ok) {
    throw new Error(`S3 get failed (${resp.status}) for ${key}`);
  }
  const total = parseInt(resp.headers.get("content-length") || "0", 10);
  if (!resp.body || !onProgress) {
    return new Uint8Array(await resp.arrayBuffer());
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, total: total || loaded, key });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function listL2Prefix(station, dateClean) {
  const year = dateClean.slice(0, 4);
  const month = dateClean.slice(4, 6);
  const day = dateClean.slice(6, 8);
  return `${year}/${month}/${day}/${station}/`;
}

export function listL3Prefix(station, dateClean, productCode) {
  const site = level3StationId(station);
  const y = dateClean.slice(0, 4);
  const m = dateClean.slice(4, 6);
  const d = dateClean.slice(6, 8);
  return `${site}_${productCode}_${y}_${m}_${d}_`;
}

export function level3StationId(station) {
  const id = String(station || "").toUpperCase();
  if (id.length === 4 && "KPT".includes(id[0])) return id.slice(1);
  return id;
}

export { L2_BUCKET, L3_BUCKET };
