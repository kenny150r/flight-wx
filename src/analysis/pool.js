export function defaultConcurrency(kind = "decode") {
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  if (kind === "download") return Math.min(3, Math.max(2, cores));
  if (kind === "list") return Math.min(4, Math.max(3, cores));
  return 2;
}

export async function mapPool(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let i = 0;
  const n = Math.min(Math.max(1, limit || 1), Math.max(1, list.length));
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  }
  if (!list.length) return out;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
