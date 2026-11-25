// Verified endpoints and tuning values. Endpoints were checked live on 2026-11-25.
// See MECHANICS.md for where every number comes from.

export const REFRESH_SECONDS = 120;

/** Area covering the St. Johns basin from Fort Drum marsh to the Mayport mouth. */
export const BASIN_BBOX = { xmin: -82.1, ymin: 27.45, xmax: -80.35, ymax: 30.65 };

/** Default map view: Titusville, Geneva, Lake Harney and Cocoa. */
export const DEFAULT_VIEW = { center: [-80.93, 28.56] as [number, number], zoom: 9.6 };
export const SQUIRES_DRIVE = { lat: 28.6512, lon: -80.8756, label: 'Squires Dr, Titusville' };

export const USGS_HUCS = ['03080101', '03080102', '03080103', '03080201', '03080202', '03080203'];

export const ENDPOINTS = {
  nwpsGauges: 'https://api.water.noaa.gov/nwps/v1/gauges',
  usgsIV: 'https://waterservices.usgs.gov/nwis/iv/',
  usgsSite: 'https://waterservices.usgs.gov/nwis/site/',
  nwsAlerts: 'https://api.weather.gov/alerts/active?area=FL',
  epqs: 'https://epqs.nationalmap.gov/v1/json',
  nldi: 'https://api.water.usgs.gov/nldi/linked-data',
  sjrwmd: 'https://services.arcgis.com/s8wtJX9suxFen6TA/arcgis/rest/services',
  brevard: 'https://gis.brevardfl.gov/gissrv/rest/services',
  titusville: 'https://gis.titusville.com/arcgis/rest/services/StormwaterFeatures/MapServer',
  nhd: 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer',
  fema: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
};

/** Cache lifetimes (ms). Upstream sources publish far less often than we poll. */
export const TTL = {
  nwpsList: 100_000,
  usgsLatest: 100_000,
  alerts: 100_000,
  nwpsSeries: 10 * 60_000,
  usgsRecent: 10 * 60_000,
  rain: 5 * 60_000,
  nwpsDetail: 6 * 3600_000,
  siteInfo: 24 * 3600_000,
  gis: 12 * 3600_000,
  history: 5 * 60_000,
};

/** Measurement age limits (minutes). */
export const FRESH_MAX_MIN = 120; // older than this: "stale"
export const OLD_MAX_MIN = 24 * 60; // older than this: treated as unavailable for colouring

/** Change over 3 hours above this many feet counts as rising/falling. */
export const TREND_THRESHOLD_FT = 0.05;
export const TREND_WINDOW_H = 3;

/** Counties whose NWS alerts are shown (St. Johns basin and the Titusville coast). */
export const ALERT_COUNTIES = [
  'Brevard', 'Seminole', 'Volusia', 'Orange', 'Osceola', 'Indian River', 'Lake', 'Putnam', 'Flagler',
  'St. Johns', 'Clay', 'Duval', 'Nassau', 'Marion', 'Okeechobee', 'Alachua', 'Baker', 'Bradford', 'Union',
];
export const ALERT_EVENT_PATTERN = /flood|hydrologic|tropical|hurricane|storm surge|rain|severe thunderstorm|tornado|extreme wind|special weather|evacuation|civil emergency|dam/i;
