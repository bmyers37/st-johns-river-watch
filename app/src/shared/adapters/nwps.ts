// NOAA National Water Prediction Service (api.water.noaa.gov/nwps/v1).
// Gives official flood categories, thresholds, observations, forecasts and historic crests.
import { BASIN_BBOX, ENDPOINTS } from '../config';
import { fetchJson, isObj } from '../http';
import type { Crest, Severity, SeriesPoint, Thresholds } from '../types';

export interface NwpsGauge {
  lid: string;
  name: string;
  lat: number;
  lon: number;
  wfo: string;
  observed: { value: number | null; unit: string; category: string; time: string | null; flow: number | null; flowUnit: string };
  forecast: { value: number | null; category: string; time: string | null };
}

const num = (x: unknown): number | null => (typeof x === 'number' && isFinite(x) && x > -900 ? x : null);
const time = (x: unknown): string | null => (typeof x === 'string' && !x.startsWith('0001') ? x : null);

export async function fetchNwpsGauges(): Promise<NwpsGauge[]> {
  const b = BASIN_BBOX;
  const url = `${ENDPOINTS.nwpsGauges}?bbox.xmin=${b.xmin}&bbox.ymin=${b.ymin}&bbox.xmax=${b.xmax}&bbox.ymax=${b.ymax}&srid=EPSG_4326`;
  const j = await fetchJson(url, (x): x is { gauges: any[] } => isObj(x) && Array.isArray((x as any).gauges));
  return j.gauges
    .filter((g) => isObj(g) && typeof g.lid === 'string' && typeof g.latitude === 'number')
    .map((g) => {
      const o = g.status?.observed ?? {};
      const f = g.status?.forecast ?? {};
      const flowMult = o.secondaryUnit === 'kcfs' ? 1000 : 1;
      const flow = num(o.secondary);
      return {
        lid: g.lid,
        name: String(g.name ?? g.lid),
        lat: g.latitude,
        lon: g.longitude,
        wfo: g.wfo?.abbreviation ?? '',
        observed: {
          value: num(o.primary),
          unit: o.primaryUnit ?? 'ft',
          category: String(o.floodCategory ?? ''),
          time: time(o.validTime),
          flow: flow === null ? null : flow * flowMult,
          flowUnit: 'cfs',
        },
        forecast: { value: num(f.primary), category: String(f.floodCategory ?? ''), time: time(f.validTime) },
      } satisfies NwpsGauge;
    });
}

export interface NwpsDetail {
  lid: string;
  usgsId?: string;
  county?: string;
  thresholds: Thresholds | null;
  datums: { label: string; abbrev: string; value: number }[];
  historicCrests: Crest[];
  recentCrests: Crest[];
  impacts: { stage: number; statement: string }[];
  upstream?: string;
  downstream?: string;
  forecastReliability?: string;
  hydrographImage?: string;
  inService: boolean;
  description?: string;
}

const crest = (c: any): Crest | null =>
  isObj(c) && typeof c.stage === 'number' && c.stage > -900
    ? { time: String(c.occurredTime), stage: c.stage, flow: num(c.flow) ?? undefined, preliminary: c.preliminary === 'P', oldDatum: !!c.olddatum }
    : null;

export async function fetchNwpsDetail(lid: string): Promise<NwpsDetail> {
  const j: any = await fetchJson(`${ENDPOINTS.nwpsGauges}/${encodeURIComponent(lid)}`, (x): x is any => isObj(x) && (x as any).lid === lid);
  const cats = j.flood?.categories ?? {};
  const t: Thresholds = {};
  for (const k of ['action', 'minor', 'moderate', 'major'] as const) {
    const v = num(cats[k]?.stage);
    if (v !== null) t[k] = v;
  }
  const datums = (j.datums?.vertical?.value ?? [])
    .filter((d: any) => isObj(d) && typeof d.value === 'number')
    .map((d: any) => ({ label: String(d.label ?? d.abbrev), abbrev: String(d.abbrev ?? ''), value: d.value }));
  return {
    lid,
    usgsId: j.usgsId || undefined,
    county: j.county || undefined,
    thresholds: Object.keys(t).length ? t : null,
    datums,
    historicCrests: (j.flood?.crests?.historic ?? []).map(crest).filter(Boolean) as Crest[],
    recentCrests: (j.flood?.crests?.recent ?? []).map(crest).filter(Boolean) as Crest[],
    impacts: (j.flood?.impacts ?? []).filter((i: any) => isObj(i) && typeof i.stage === 'number').map((i: any) => ({ stage: i.stage, statement: String(i.statement) })),
    upstream: j.upstreamLid || undefined,
    downstream: j.downstreamLid || undefined,
    forecastReliability: j.forecastReliability || undefined,
    hydrographImage: j.images?.hydrograph?.default || undefined,
    inService: j.inService?.enabled !== false,
    description: j.description || undefined,
  };
}

export interface NwpsStageflow {
  observed: SeriesPoint[];
  observedFlow: SeriesPoint[];
  forecast: SeriesPoint[];
  forecastIssued?: string;
  observedUnits: string;
}

export async function fetchNwpsStageflow(lid: string): Promise<NwpsStageflow> {
  const j: any = await fetchJson(`${ENDPOINTS.nwpsGauges}/${encodeURIComponent(lid)}/stageflow`, (x): x is any => isObj(x));
  const toPts = (arr: any[], key: 'primary' | 'secondary', mult = 1) =>
    (Array.isArray(arr) ? arr : [])
      .map((d) => ({ t: Date.parse(d.validTime), v: num(d[key]) }))
      .filter((p): p is SeriesPoint => p.v !== null && isFinite(p.t))
      .map((p) => ({ t: p.t, v: p.v * mult }));
  const obs = j.observed ?? {};
  const fc = j.forecast ?? {};
  const flowMult = obs.secondaryUnits === 'kcfs' ? 1000 : 1;
  return {
    observed: toPts(obs.data, 'primary'),
    observedFlow: toPts(obs.data, 'secondary', flowMult),
    forecast: toPts(fc.data, 'primary'),
    forecastIssued: time(fc.issuedTime) ?? undefined,
    observedUnits: obs.primaryUnits ?? 'ft',
  };
}

export function categoryToSeverity(cat: string): Severity | null {
  switch (cat) {
    case 'no_flooding':
      return 'normal';
    case 'action':
      return 'action';
    case 'minor':
      return 'minor';
    case 'moderate':
      return 'moderate';
    case 'major':
      return 'major';
    default:
      return null; // not_defined, low_threshold, out_of_service, obs_not_current ...
  }
}

export function severityFromThresholds(v: number, t: Thresholds | null): Severity | null {
  if (!t) return null;
  if (t.major !== undefined && v >= t.major) return 'major';
  if (t.moderate !== undefined && v >= t.moderate) return 'moderate';
  if (t.minor !== undefined && v >= t.minor) return 'minor';
  if (t.action !== undefined && v >= t.action) return 'action';
  if (t.action === undefined && t.minor === undefined) return null;
  return 'normal';
}

/** Which datum the reported stage is in, from the "(in MHHW)" style suffix in NWPS names. */
export function stageDatumFromName(name: string): string | null {
  const m = name.match(/\(in ([A-Z0-9*]+)\)/i);
  return m ? m[1].replace('*', '').toUpperCase() : null;
}
