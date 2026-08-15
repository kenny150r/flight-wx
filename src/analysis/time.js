export function timeZoneForLon(lon) {
  if (!Number.isFinite(lon)) return "UTC";
  if (lon >= -87.5) return "America/New_York";
  if (lon >= -104) return "America/Chicago";
  if (lon >= -115) return "America/Denver";
  if (lon >= -130) return "America/Los_Angeles";
  return "UTC";
}

export function formatTrackTime(ms, { lon } = {}) {
  if (!Number.isFinite(ms)) return { utc: "", local: "", label: "", timeZone: "UTC" };
  const date = new Date(ms);
  const utc = date.toISOString().replace(".000Z", "Z");
  const timeZone = timeZoneForLon(lon);
  if (timeZone === "UTC") return { utc, local: utc, label: utc, timeZone };
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
  return { utc, local, label: `${local} · ${utc}`, timeZone };
}
