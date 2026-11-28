# St. Johns River Watch

A live monitoring dashboard for the St. Johns River, Florida, from its headwaters to Jacksonville.
It opens with a basin overview on the first visit and remembers the last view in that browser.
Select **Near me** to search for a town or gauge. Select **Use my location** and grant browser permission to center the map and see nearby gauge readings.

* **Live map**: every NOAA/NWS forecast point and USGS gauge in the basin, coloured by official flood
  category, with the water level, a rising/falling arrow, stale-data marks and pulsing for moderate or major floods.
* **Station panel**: current stage, flood category, distance to flood stage, flow, water-surface
  elevation (with its datum), 1–48 h changes, interactive 24 h–90 day graphs with flood bands and the
  official NWS forecast, historical crests, NWS impact statements, and links to the official pages.
* **Drainage & flood control**: City of Titusville stormwater pipes, inlets, control structures, weirs and channels; Brevard County drainage ditches, SJRWMD gates, weirs, pumps, culverts and
  levees, USGS NHD canals, culverts, dams, ponds and reservoirs, SJRWMD drainage basins, FEMA flood zones and
  terrain shading. Each layer has its own switch. Structures always say **"Operational status unknown"**,
  because no public source publishes live gate positions.
* **Drop a pin** (📍 button, then click the map) to get ground elevation, surrounding terrain, the mapped
  (NHDPlus) drainage path to the river, a terrain-based *estimate*, nearby infrastructure, nearby river
  levels and a same-datum backwater check.
* **Dashboard**: active stations, stations above flood stage, rising and falling counts, highest severity,
  official flood warnings, last refresh and a countdown. Also a sortable station table, favourites (☆),
  saved locations and USGS rainfall totals.
* **Alerts**: official NWS warnings (red, marked OFFICIAL NWS) are kept apart from the app's own alerts:
  level above a value, entering flood stage, rapid rise, forecast changes, new warnings and stale data. Browser
  notifications are optional.
* Refreshes every **120 seconds** without moving the map. Each reading shows when it was *measured*; most
  gauges report every 15–60 minutes, so many refreshes bring no new measurement.
* Dark or light theme, full-screen map (⤢ button or Esc to leave), and your settings are remembered.

## Standalone Windows executable

Download `St-Johns-River-Watch-windows-x64.exe` from the [latest GitHub release](https://github.com/bmyers37/st-johns-river-watch/releases/latest). Double-click it to start the local server and open the dashboard in your browser. The executable includes Node and the built app. Live river data and map tiles require internet access. Close the console window to stop the server.

To build the executable from source, use Node.js 26 or newer on Windows and run `npm ci` followed by `npm run package:windows` in this directory. The executable is created under `release/`.

## Starting from source (Windows)

1. Install **Node.js** (free): <https://nodejs.org> → "LTS" → install with the default options.
2. Double-click **`Start River Watch.bat`** in this folder.
   * The first start installs components and builds the app (a few minutes, needs internet).
   * Your browser opens at <http://127.0.0.1:5179>. Keep the black window open while you use the app;
     close it to stop.
3. For a dedicated monitor, use **`Start River Watch (full screen).bat`**. It opens Microsoft Edge in
   full screen. Press Alt+F4 to close that window.

The first data load takes 20–60 seconds because the USGS services are slow. After that, refreshes are quick.

There is also a small launcher program (`target\debug\st-johns-river-watch.exe` after `cargo build`). It
does the same as the .bat file.

### Other systems / manual start

```
npm install
npm run build
npm start          # serves http://127.0.0.1:5179  (PORT=xxxx to change)
```

`npm run smoke` runs an end-to-end check against live data with headless Chrome/Edge. It saves
screenshots in `shots/`. `npm run dev` runs the Vite dev server for editing (start `npm start` too).

No API keys or paid services are used.

## Where the data comes from

| Data | Source | Endpoint |
|---|---|---|
| Official flood categories, thresholds, observations (30 days), forecasts, historic crests, impacts, datums | NOAA National Water Prediction Service | `api.water.noaa.gov/nwps/v1/gauges` |
| Stage, discharge, history, rain gauges, gauge datums | USGS Water Data APIs | `api.waterdata.usgs.gov/ogcapi/v1/collections` |
| Official warnings, watches and advisories (+ polygons) | National Weather Service | `api.weather.gov/alerts/active?area=FL` |
| Stormwater pipes/culverts, inlets, control structures and weirs (with invert elevations where recorded), channels, basins | City of Titusville | `gis.titusville.com/arcgis/rest/services/StormwaterFeatures/MapServer` |
| Drainage ditches (with recorded flow direction) | Brevard County Public Works | `gis.brevardfl.gov/.../External_PW_Roadways_and_Drainage_Ditches` |
| Water control structures, levees, major and planning-unit drainage basins | St. Johns River Water Management District | ArcGIS Online `services.arcgis.com/s8wtJX9suxFen6TA` |
| Rivers, tributaries, canals, culverts/pipelines, dams/weirs/gates, ponds/reservoirs | USGS National Hydrography Dataset | `hydro.nationalmap.gov/arcgis/rest/services/nhd` |
| St. Johns main stem, downstream path from a pin | USGS NLDI (NHDPlus V2) | `api.water.usgs.gov/nldi` |
| Ground elevation | USGS 3DEP Elevation Point Query Service | `epqs.nationalmap.gov/v1` |
| Terrain shading, terrain-path estimate | AWS Terrain Tiles (from USGS 3DEP) | `s3.amazonaws.com/elevation-tiles-prod` |
| FEMA flood zones | FEMA National Flood Hazard Layer | `hazards.fema.gov/arcgis/rest/services/public/NFHL` |
| Base maps | Esri (dark grey, streets, imagery), USGS Topo | `server.arcgisonline.com`, `basemap.nationalmap.gov` |

Self-hosted deployments can set the optional server-side `USGS_API_KEY` environment variable for higher USGS request limits. [USGS API documentation](https://api.waterdata.usgs.gov/docs/ogcapi/)

## How the data is handled

* **Nothing is invented.** If a value is missing, the app says "—", "No data" or "Unavailable". Readings
  older than 2 hours are marked stale. Readings older than 24 hours turn the marker grey. USGS
  provisional/estimated flags are shown.
* **Datums are never mixed.** Stage is in each gauge's own datum, and tidal gauges use MHHW. A water-surface
  elevation is only shown where NOAA or USGS publish the gauge-zero elevation. The pin analysis compares
  ground (NAVD88) only with NAVD88 water surfaces, and only at the gauge where the mapped drainage reaches the river.
* **Estimates are labelled.** The terrain path and ground elevation are marked "estimate". The NHDPlus path
  is marked "mapped". Neither is an engineering assessment.
* **Connection problems:** the last good data stays on screen with a "Connection problem · showing data from
  …" notice. The app retries after 15 s, 30 s, 60 s, then every 120 s. The server keeps the last good answer from
  each source if that source fails, and the 🗄 button shows the health of every source.

## Unavailable or incomplete

* **SJRWMD real-time data** (gate positions, structure discharge, district-only gauges): no public
  machine-readable feed was found, and the district's hydrologic data website blocks automated access. District
  gauges shared with USGS or NWS still appear through those sources.
* **Gate / pump operating status:** not published by any public source used here, so it is always shown as
  "Operational status unknown".
* **Retention ponds:** no public stormwater-pond inventory was found for Brevard County / Titusville. NHD
  ponds are shown and labelled "may be stormwater ponds – not verified".
* **Culverts:** inside Titusville city limits the city's pipe inventory covers them. Elsewhere only those in
  NHD or the SJRWMD structure inventory appear. Pipe flow direction and many elevations are not recorded.
* **Rainfall:** only USGS rain gauges in the basin (few). NWS station rainfall is not reported reliably by
  the API, and radar rainfall needs non-free products.
* **Historical flood records** come from NWPS crest lists; some gauges have none.
* **Water-surface elevations** exist only where a gauge-zero elevation is published (e.g. Cocoa and
  Jacksonville in NAVD88, Christmas, Melbourne and Astor in NGVD29). Many main-stem gauges have none, so the
  backwater check often reports that no like-for-like comparison is possible.
* Flood thresholds exist only for NWS forecast points. USGS-only sites are grey ("no published threshold").

## Project layout

```
server/index.ts         local server: static files + caching API (/api/snapshot, /history, /detail, /layer, /point, /mainstem)
src/shared/             data adapters (nwps, usgs, nws, gis), retry/timeout/cache helpers, data engine
src/components/         map, dashboard, station panel, pin analysis, alerts, layers, charts
src/lib/                formatting, saved preferences, alert rules, terrain path estimate
src/main.rs + Cargo.toml   small launcher program (--screenshot / --self-test for automated checks)
scripts/                smoke test and capture helpers (headless Chrome/Edge)
MECHANICS.md            every tuning number and where it comes from
```
