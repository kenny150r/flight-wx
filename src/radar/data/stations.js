import stations from "./stations.json";

const byId = new Map(stations.map((s) => [s.id, s]));

export function getStationList() {
  return stations;
}

export function getStation(stationId) {
  return byId.get(String(stationId || "").toUpperCase()) || null;
}
