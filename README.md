# flight-wx

In-browser report of the strongest NEXRAD reflectivity, radar radial velocity, and gate-to-gate shear a flight flew through.

Live: https://kenny150r.github.io/flight-wx/

Enter a flight number and UTC date, or upload a CSV/GeoJSON track. The app looks up a public ADS-B trace when it can, walks the path across CONUS WSR-88D sites, downloads NOAA Level II volumes from the Unidata S3 archive in parallel, and samples reflectivity and velocity at flight level.

**Examples:** Use the Examples menu for NTSB-aligned representative tracks (airline turbulence/hail, airport LLWS, and a few GA convective cases). Public historical ADS-B is usually missing, so these paths are synthesized along the scheduled route and timed to the reported encounter. Start with [Endeavor 4985](https://kenny150r.github.io/flight-wx/?flight=EDV4985&date=20250717) or [Southwest 2231](https://kenny150r.github.io/flight-wx/?flight=SWA2231&date=20250502).

## Run locally

```bash
npm install
npm test
npm run dev
```

Open http://localhost:8000. The map is the main stage; peak cards sit in a slim rail, and time series run along the bottom.

## Track upload

CSV header (names are flexible):

```
time,lat,lon,alt_ft,heading,gs,vs
2013-05-20T19:51:11Z,35.2,-97.1,35000,090,420,0
```

Heading, ground speed (kt), and vertical speed (fpm) are optional. If they are missing, the app derives them from successive points. Time and altitude are required — the app will not invent “now” or 0 ft. Use `alt_m` for meters. Clicking a sample shows flight level, heading, speed, and climb/descent at that point.

GeoJSON `Point`, `LineString`, or `FeatureCollection` also work. `times` are required. `altitudes` / `alt_ft` are feet; `altitudes_m` / `alt_m` and coordinate Z are meters.

An optional Mode-S hex helps historical [readsb globe-history](https://github.com/wiedehopf/readsb/blob/dev/README-json.md#trace-jsons) lookups. Public callsign APIs are best-effort and often fail for older dates — upload is the reliable path.

## What the numbers mean

- **Max reflectivity** — dBZ at the aircraft, using the tilt whose 4/3-earth beam is closest to altitude. Nearby max is the strongest gate within 5 km on that tilt. The 5 km mean series is the arithmetic mean of finite gates in that same window.
- **Max composite reflectivity** — strongest dBZ in the column at that lat/lon (max over all tilts). Click the card to load the tilt that held the peak.
- **Time series** — closest-beam, 5 km mean, and composite dBZ on one reflectivity chart, plus signed radial velocity. Lines break across out-of-range or missing-gate stretches instead of connecting through them. Drag to zoom a time range, Expand for a larger window, then click a point to load that scan. Click a peak, table row, or track point to load that station’s Level II scan on the map (WebGL polar overlay, same approach as RadarRewind). Visible and IR load the nearest 15-minute GOES CONUS frame under the radar; IR is color-enhanced cloud-top temperature. The popup and radar HUD show flight state at that point (flight level, heading, ground speed, vertical speed).
- **Play flight** — steps through the path in time, or drag the slider to scrub. Decoded radar frames are cached so station/tilt changes stay smooth after the first load.
- **Max |Vr|** — NEXRAD radial velocity (toward/away from the radar), not true wind. No dealiasing.
- **Max horizontal shear** — strongest azimuthal (gate-to-gate) radial-velocity shear in a ~2.5 km window, in kt/km and s⁻¹. Click the card to zoom to that event and load velocity.
- **Max vertical shear** — strongest dVr/dz at the aircraft from neighboring tilts (along-beam fallback if only one velocity tilt), in kt/km and kt/1000 ft. Click the card to zoom to that event and load velocity.

Low-confidence flags mean the beam missed the aircraft by more than 1 km, or the gate was empty. Oceanic and non-US legs are outside CONUS NEXRAD range.

## Data

- NEXRAD Level II: `unidata-nexrad-level2` (no auth, open CORS)
- GOES visible / IR overlays: Iowa Environmental Mesonet CONUS 4 km GeoTIFF archive (15-minute vis/IR, time-matched to the selected sample; native ABI CONUS is ~5 minutes)
- Station list and in-browser decoder adapted from [RadarRewind](https://github.com/kenny150r/RadarRewind)
- Live / recent tracks: adsb.lol, adsb.fi, airplanes.live, adsbdb

## Deploy

Push to `main`. GitHub Actions builds the Vite app with `base: /flight-wx/` and deploys GitHub Pages.
