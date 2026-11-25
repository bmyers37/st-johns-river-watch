// USGS Water Services (waterservices.usgs.gov): instantaneous values and site metadata.
// Parameter codes: 00065 gauge height (ft), 00060 discharge (cfs), 00045 precipitation (in),
// 62614 lake elevation NGVD29 (ft), 62615 lake elevation NAVD88 (ft).
import { BASIN_BBOX, ENDPOINTS, USGS_HUCS } from '../config';
import { fetchJson, fetchText, isObj } from '../http';
import type { SeriesPoint } from '../types';

export interface UsgsSeries {
  site: string;
  name: string;
  lat: number;
  lon: number;
  param: string;
  unit: string;
  points: (SeriesPoint & { q?: string[] })[];
}

function parseIV(j: any): UsgsSeries[] {
  const out: UsgsSeries[] = [];
  for (const ts of j?.value?.timeSeries ?? []) {
    try {
      const si = ts.sourceInfo;
      const noData = ts.variable?.noDataValue ?? -999999;
      const vals = ts.values?.[0]?.value ?? [];
      out.push({
        site: si.siteCode[0].value,
        name: si.siteName,
        lat: si.geoLocation.geogLocation.latitude,
        lon: si.geoLocation.geogLocation.longitude,
        param: ts.variable.variableCode[0].value,
        unit: ts.variable.unit?.unitCode ?? '',
        points: vals
          .map((v: any) => ({ t: Date.parse(v.dateTime), v: parseFloat(v.value), q: v.qualifiers }))
          .filter((p: any) => isFinite(p.t) && isFinite(p.v) && p.v !== noData),
      });
    } catch {
      /* skip malformed series */
    }
  }
  return out;
}

const validIV = (x: unknown): x is any => isObj(x) && isObj((x as any).value) && Array.isArray((x as any).value.timeSeries);

/** Latest value of stage / discharge / lake elevation for every active site in the basin HUCs. */
export async function fetchUsgsLatest(): Promise<UsgsSeries[]> {
  const url = `${ENDPOINTS.usgsIV}?format=json&huc=${USGS_HUCS.join(',')}&parameterCd=00065,00060,62614,62615&siteStatus=active`;
  return parseIV(await fetchJson(url, validIV, { timeoutMs: 45000 }));
}

/** Two days of gauge height for every basin site (used for 1-48 h changes and trends). */
export async function fetchUsgsRecentStage(): Promise<UsgsSeries[]> {
  const url = `${ENDPOINTS.usgsIV}?format=json&huc=${USGS_HUCS.join(',')}&parameterCd=00065,62614,62615&siteStatus=active&period=P2DT2H`;
  return parseIV(await fetchJson(url, validIV, { timeoutMs: 60000 }));
}

export async function fetchUsgsSiteSeries(site: string, params: string[], hours: number): Promise<UsgsSeries[]> {
  const days = Math.ceil(hours / 24);
  const period = hours <= 48 ? `PT${hours + 1}H` : `P${days}D`;
  const url = `${ENDPOINTS.usgsIV}?format=json&sites=${encodeURIComponent(site)}&parameterCd=${params.join(',')}&period=${period}`;
  return parseIV(await fetchJson(url, validIV, { timeoutMs: 45000 }));
}

/** Seven days of precipitation for every USGS rain gauge in the basin area. */
export async function fetchUsgsRain(): Promise<UsgsSeries[]> {
  const b = BASIN_BBOX;
  // USGS bBox: west,south,east,north with at most 6 decimals
  const url = `${ENDPOINTS.usgsIV}?format=json&bBox=-81.75,${b.ymin},-80.4,${b.ymax}&parameterCd=00045&siteStatus=active&period=P7D`;
  return parseIV(await fetchJson(url, validIV, { timeoutMs: 60000 }));
}

export interface UsgsSiteInfo {
  site: string;
  altitude?: number;
  altitudeDatum?: string; // NGVD29 / NAVD88
  huc?: string;
}

/** Gauge-datum altitude for each site (site service, RDB format). */
export async function fetchUsgsSiteInfo(sites: string[]): Promise<Map<string, UsgsSiteInfo>> {
  const map = new Map<string, UsgsSiteInfo>();
  for (let i = 0; i < sites.length; i += 90) {
    const chunk = sites.slice(i, i + 90);
    const txt = await fetchText(`${ENDPOINTS.usgsSite}?format=rdb&sites=${chunk.join(',')}&siteOutput=expanded&siteStatus=all`, { timeoutMs: 45000 });
    const lines = txt.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    if (lines.length < 3) continue;
    const head = lines[0].split('\t');
    const ix = (n: string) => head.indexOf(n);
    for (const l of lines.slice(2)) {
      const c = l.split('\t');
      const alt = parseFloat(c[ix('alt_va')]);
      map.set(c[ix('site_no')], {
        site: c[ix('site_no')],
        altitude: isFinite(alt) ? alt : undefined,
        altitudeDatum: c[ix('alt_datum_cd')]?.trim() || undefined,
        huc: c[ix('huc_cd')]?.trim() || undefined,
      });
    }
  }
  return map;
}
