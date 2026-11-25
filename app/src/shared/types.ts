// Data model shared by the Node server and the browser.
// Every measurement carries its own timestamp, source and datum. Nothing is ever filled in.

export type Severity = 'normal' | 'action' | 'minor' | 'moderate' | 'major' | 'unknown';
export type Trend = 'rising' | 'falling' | 'steady' | 'unknown';
export type Freshness = 'fresh' | 'stale' | 'old' | 'none';
export type StationGroup = 'main' | 'tributary' | 'coastal' | 'other';

export interface Measurement {
  value: number;
  unit: string;
  time: string; // ISO time the source says the value was measured
  source: string; // e.g. "NOAA NWPS (USGS sensor)"
  qualifiers?: string[]; // USGS codes: P = provisional, e = estimated
}

export interface Thresholds {
  action?: number;
  minor?: number;
  moderate?: number;
  major?: number;
}

export interface WaterSurfaceElevation {
  value: number;
  datum: 'NAVD88' | 'NGVD29';
  method: string; // how it was derived, e.g. "stage + gauge zero (-1.36 ft NAVD88) from NWPS datums"
}

export interface ForecastSummary {
  issued: string;
  crest?: { value: number; time: string };
  last?: { value: number; time: string };
  category?: Severity;
}

export interface StationLink {
  label: string;
  url: string;
}

export interface Station {
  id: string;
  lid?: string;
  usgsId?: string;
  name: string;
  lat: number;
  lon: number;
  group: StationGroup;
  county?: string;
  sources: string[];
  stage: Measurement | null;
  stageDatum: string; // human label of what the stage is measured from
  flow: Measurement | null;
  secondaryStage?: Measurement & { note: string };
  wse: WaterSurfaceElevation | null;
  thresholds: Thresholds | null;
  severity: Severity;
  severityBasis: string;
  trend: Trend;
  changes: Partial<Record<'h1' | 'h3' | 'h6' | 'h12' | 'h24' | 'h48', number>>;
  ratePerHour?: number;
  forecast: ForecastSummary | null;
  freshness: Freshness;
  ageMinutes?: number;
  flags: string[];
  links: StationLink[];
  officialAlertIds: string[];
  inService: boolean;
}

export interface RainGauge {
  id: string;
  name: string;
  lat: number;
  lon: number;
  source: string;
  lastTime?: string;
  totals: Partial<Record<'h1' | 'h6' | 'h24' | 'h72' | 'd7', number>>;
  freshness: Freshness;
}

export interface OfficialAlert {
  id: string;
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  sent: string;
  expires?: string;
  sender: string;
  description: string;
  instruction?: string;
  url: string;
  geometry: GeoJSON.Geometry | null;
  isFlood: boolean;
  isWarning: boolean;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  lastSuccess?: string;
  lastAttempt?: string;
  error?: string;
  note?: string;
}

export interface Snapshot {
  generatedAt: string;
  stations: Station[];
  rain: RainGauge[];
  alerts: OfficialAlert[];
  sources: SourceStatus[];
  mode?: 'server' | 'direct';
}

export interface SeriesPoint {
  t: number; // epoch ms
  v: number;
}

export interface HistoryResponse {
  stationId: string;
  rangeHours: number;
  stage: { points: SeriesPoint[]; source: string; datum: string; unit: string } | null;
  flow: { points: SeriesPoint[]; source: string; unit: string } | null;
  forecast: { points: SeriesPoint[]; issued: string; source: string } | null;
  thresholds: Thresholds | null;
  notes: string[];
}

export interface Crest {
  time: string;
  stage: number;
  flow?: number;
  preliminary?: boolean;
  oldDatum?: boolean;
}

export interface StationDetail {
  stationId: string;
  historicCrests: Crest[];
  recentCrests: Crest[];
  impacts: { stage: number; statement: string }[];
  datums: { label: string; abbrev: string; value: number }[];
  forecastReliability?: string;
  upstream?: string;
  downstream?: string;
  hydrographImage?: string;
  description?: string;
}

export interface PointInfo {
  lat: number;
  lon: number;
  groundElevation: { value: number; unit: 'ft'; datum: 'NAVD88'; source: string; resolutionM?: number } | null;
  ring: { bearing: number; distanceM: number; value: number | null }[];
  hydrography: {
    comid?: string;
    downstream: GeoJSON.FeatureCollection | null;
    note: string;
  };
  errors: string[];
}
