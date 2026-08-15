# flight-wx

In-browser report of the strongest NEXRAD reflectivity, radar radial velocity, and gate-to-gate shear a flight flew through.

Live: https://kenny150r.github.io/flight-wx/

Enter a flight number and UTC date, or upload a CSV/GeoJSON track. The app looks up a public ADS-B trace when it can, walks the path across CONUS WSR-88D sites, downloads NOAA Level II volumes from the Unidata S3 archive, and samples reflectivity and velocity at flight level.

**Example:** [Endeavor Air 4985 on 17 Jul 2025](https://kenny150r.github.io/flight-wx/?flight=EDV4985&date=20250717) (JFK–CVG, also `9E4985` / `DL4985`). Public historical ADS-B is not available for that day, so the app uses a bundled representative track along the scheduled route.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open http://localhost:8000.

## Track upload

CSV header (names are flexible):

```
time,lat,lon,alt_ft
2013-05-20T19:51:11Z,35.2,-97.1,35000
```

GeoJSON `Point`, `LineString`, or `FeatureCollection` also work. Optional `times` / `altitudes` properties on a LineString.

An optional Mode-S hex helps historical [readsb globe-history](https://github.com/wiedehopf/readsb/blob/dev/README-json.md#trace-jsons) lookups. Public callsign APIs are best-effort and often fail for older dates — upload is the reliable path.

## What the numbers mean

- **Max dBZ** — reflectivity at the aircraft, using the tilt whose 4/3-earth beam is closest to altitude. Nearby max is the strongest gate within 5 km.
- **Max |Vr|** — NEXRAD radial velocity (toward/away from the radar), not true wind. No dealiasing.
- **Shear** — max of radial and azimuthal gate-to-gate shear in a ~2.5 km window, shown as kt/km and s⁻¹.

Low-confidence flags mean the beam missed the aircraft by more than 1 km, or the gate was empty. Oceanic and non-US legs are outside CONUS NEXRAD range.

## Data

- NEXRAD Level II: `unidata-nexrad-level2` (no auth, open CORS)
- Station list and in-browser decoder adapted from [RadarRewind](https://github.com/kenny150r/RadarRewind)
- Live / recent tracks: adsb.lol, adsb.fi, airplanes.live, adsbdb

## Deploy

Push to `main`. GitHub Actions builds the Vite app with `base: /flight-wx/` and deploys GitHub Pages.
