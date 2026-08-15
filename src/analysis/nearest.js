import { haversineKm } from "./geo.js";

export const MAX_RADAR_KM = 230;

export function findNearestStation(lat, lon, stations, maxKm = MAX_RADAR_KM) {
  let best = null;
  let bestKm = Infinity;
  for (const station of stations) {
    const km = haversineKm(lat, lon, station.lat, station.lon);
    if (km < bestKm) {
      bestKm = km;
      best = station;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return { station: best, km: bestKm };
}

export function assignStations(points, stations, maxKm = MAX_RADAR_KM) {
  return points.map((point) => {
    const nearest = findNearestStation(point.lat, point.lon, stations, maxKm);
    return {
      ...point,
      station: nearest?.station || null,
      stationKm: nearest?.km ?? null,
    };
  });
}
