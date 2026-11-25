# St. Johns River Watch — settings sheet

This is a monitoring dashboard, not a game. This sheet lists every number that shapes how it behaves,
and where each one comes from. "Request" = the person's written request. "Verified" = checked live
against the public service on 2026-11-25. "Chosen" = a value picked for this app (estimated, can be tuned).
The same values are in `mechanics.json`.

## Refresh and freshness

| Setting | Value | Source |
|---|---|---|
| Automatic refresh | every 120 s, map position kept | Request |
| Retry after a failed refresh | 15 s, 30 s, 60 s, then 120 s | Chosen (exponential backoff) |
| Request timeout | 20 s (most sources), 45–60 s for USGS basin queries | Chosen; USGS basin queries took 14–26 s when verified |
| Retries per upstream request | 2, with 0.8 s × 2ⁿ backoff | Chosen |
| "Current" reading | measured ≤ 120 min ago | Chosen (gauges report every 15–60 min) |
| "Stale" reading | 2–24 h old; colour kept, dashed ring + ⚠ | Chosen |
| "Out of date" reading | > 24 h old; shown grey (treated as unavailable) | Chosen |

## Server cache lifetimes

| Data | Kept for | Why |
|---|---|---|
| NOAA NWPS gauge list + current status | 100 s | Just under the 120 s refresh |
| USGS latest values | 100 s | Same |
| NWS active alerts | 100 s | Same |
| NWPS observation + forecast series per gauge | 10 min | NWPS updates hourly |
| USGS 48-hour stage history (trends) | 10 min | Large basin-wide query |
| USGS rain gauges (7 days) | 5 min | |
| NWPS thresholds, crests, datums | 6 h | Rarely change |
| USGS gauge datums | 24 h | Rarely change |
| GIS layers | 12 h | Inventories, not live data |
| Station history requests | 5 min | |

## Flood severity (official thresholds)

| Colour | Meaning | Source |
|---|---|---|
| Green `#22c55e` | Normal (below action stage) | Request; category from NOAA NWPS |
| Yellow `#facc15` | Action stage | Request; NWS threshold |
| Orange `#fb923c` | Minor flooding | Request; NWS threshold |
| Red `#ef4444` | Moderate flooding | Request; NWS threshold |
| Purple `#a855f7` | Major flooding | Request; NWS threshold |
| Grey `#6b7280` | No data, out of service, or no published threshold | Request |

The category comes straight from NWPS when the shown reading is the NWPS reading; if a newer
NWPS series point is shown, it is computed from the same official thresholds. USGS-only sites have
no NWS thresholds and stay grey (their level is still shown).

Pulsing markers: moderate or major flooding with a current reading (can be switched off).

## Trends and changes

| Setting | Value | Source |
|---|---|---|
| Trend window | 3 h change | Chosen |
| Rising / falling | change > +0.05 ft / < −0.05 ft | Chosen (St. Johns rises slowly) |
| Change windows shown | 1, 6, 12, 24, 48 h | Request |
| Matching tolerance for "N hours ago" | 1 h: ±20 min, 3 h: ±40, 6 h: ±60, 12 h: ±90, 24 h: ±120, 48 h: ±180 | Chosen |
| Rate of change | 1-hour change (ft/h), or 3-hour change ÷ 3 | Chosen |

## Datums (never mixed)

* Stage is in each gauge's own datum (local gauge datum, or MHHW for tidal gauges, from the NWPS name suffix).
* Water-surface elevation = stage + gauge-zero elevation published by NWPS (NAVD88 or NGVD29), or + USGS
  gauge datum only when the USGS gauge height matches the NWS stage within 0.06 ft. Verified: Cocoa
  gauge zero −1.36 ft NAVD88; Jacksonville MHHW zero +0.63 ft NAVD88.
* Pin analysis compares ground (USGS 3DEP, NAVD88) only with NAVD88 water surfaces, and only at the gauge
  nearest to where the mapped drainage path joins the river.
* 90-day graphs use the USGS record only when its gauge height matches the NWS stage within 0.06 ft
  (NWPS itself publishes ~30 days).

## App alerts (defaults, all adjustable)

| Rule | Default | Source |
|---|---|---|
| Stations covered | main stem + favourites | Chosen |
| Entering flood stage | on, minor or worse | Request |
| Rapid rise | ≥ 0.20 ft/hour, tidal gauges ignored | Chosen |
| Forecast change | crest moves ≥ 0.2 ft in a new forecast | Chosen |
| New official warnings | on | Request |
| Stale / unavailable data | on | Request |
| Browser notifications | off until permission given | Request |
| Alert history kept | 150 | Chosen |

## Map

| Setting | Value | Source |
|---|---|---|
| Default view | centre −80.93, 28.56, zoom 9.6 (Titusville · Geneva · Lake Harney · Cocoa) | Request |
| Squires Drive | 28.6512, −80.8756 | OpenStreetMap (Overpass) lookup |
| Basin area queried | −82.1 to −80.35 W, 27.45 to 30.65 N | Chosen to cover Fort Drum marsh to Mayport |
| USGS basin HUCs | 03080101–03, 03080201–03 | USGS hydrologic units |
| Small-station labels | shown from zoom 10.3 | Chosen (less clutter) |
| Drainage ditches, NHD lines, sub-basins | from zoom 11 | Chosen (data volume) |
| Ponds / reservoirs | from zoom 12 | Chosen |
| FEMA flood zones | from zoom 10 | Chosen |
| Flow animation | only on river reaches within ~35 km of a gauge measuring discharge; reversed where measured discharge is negative | Request ("based on verified data") |

## Local drainage analysis

| Setting | Value | Source |
|---|---|---|
| Ground elevation | USGS EPQS (3DEP), ft NAVD88 | Verified |
| Terrain ring | 8 directions × 150 m and 400 m | Chosen |
| Mapped path | NHDPlus downstream-main navigation, 150 km | Verified (USGS NLDI) |
| Terrain estimate | steepest descent on AWS Terrain Tiles z14 (~10 m), up to 260 steps, search radius 1–6 cells | Chosen |
| Backwater flags | ground − river surface < 0 ft: above ground; < 2 ft: little height left | Chosen |
| Nearby infrastructure radius | 3 km | Chosen |
