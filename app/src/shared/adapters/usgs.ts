// Modern USGS Water Data APIs. Continuous readings are paginated GeoJSON features.
import { BASIN_BBOX, ENDPOINTS, TTL, USGS_HUCS } from '../config';
import { fetchJson, isObj, TtlCache } from '../http';
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

export interface UsgsSiteInfo {
  site: string;
  name?: string;
  altitude?: number;
  altitudeDatum?: string;
  huc?: string;
}

interface Feature {
  properties: Record<string, unknown> | null;
  geometry: { coordinates?: number[] } | null;
}

interface Page {
  features: Feature[];
  links?: { rel: string; href: string }[];
}

const validPage = (value: unknown): value is Page => isObj(value) && Array.isArray(value.features);
const watershedFilter = USGS_HUCS.map((huc) => "hydrologic_unit_code LIKE '" + huc + "%'").join(' OR ');
const bbox = [BASIN_BBOX.xmin, BASIN_BBOX.ymin, BASIN_BBOX.xmax, BASIN_BBOX.ymax].join(',');
const stageParams = '00065,62614,62615';
const locationCache = new TtlCache();

async function* features(collection: string, params: Record<string, string>): AsyncGenerator<Feature> {
  const endpoint = new URL(ENDPOINTS.usgs + '/' + collection + '/items');
  endpoint.search = new URLSearchParams({ limit: '10000', ...params }).toString();
  let url: URL | null = endpoint;
  const visited = new Set<string>();
  const key = typeof window === 'undefined' ? process.env.USGS_API_KEY?.trim() : undefined;
  while (url) {
    if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname ||
        visited.has(url.href) || visited.size >= 40) {
      throw new Error('USGS returned an unexpected pagination link');
    }
    visited.add(url.href);
    const page: Page = await fetchJson(url.href, validPage, {
      timeoutMs: 20000,
      retries: 1,
      headers: { Accept: 'application/geo+json', ...(key ? { 'X-Api-Key': key } : {}) },
    });
    yield* page.features;
    const next: string | undefined = page.links?.find((link) => link.rel === 'next')?.href;
    url = next ? new URL(next, url) : null;
  }
}

function timeRange(hours: number) {
  return new Date(Date.now() - hours * 3600_000).toISOString() + '/..';
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value !== 'number' && !text(value)) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function readings(collection: string, filters: Record<string, string>) {
  const all = new Map<string, UsgsSeries>();
  for await (const feature of features(collection, { agency_code: 'USGS', ...filters })) {
    const p = feature?.properties;
    const location = text(p?.monitoring_location_id);
    const site = location?.match(/^USGS-(\d+)$/)?.[1];
    const param = text(p?.parameter_code);
    const t = Date.parse(text(p?.time) ?? '');
    const v = number(p?.value);
    const unit = text(p?.unit_of_measure);
    const [lon, lat] = feature?.geometry?.coordinates ?? [];
    if (!p || !site || !param || !Number.isFinite(t) || v === undefined ||
        !unit || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if ((param === '00045' && (unit !== 'in' || v < 0)) ||
        (param === '00060' && !['ft^3/s', 'ft3/s'].includes(unit)) ||
        (param !== '00045' && param !== '00060' && unit !== 'ft')) continue;

    const id = [site, param, text(p.time_series_id)].join(':');
    let series = all.get(id);
    if (!series) {
      series = { site, name: 'USGS ' + site, lat, lon, param, unit, points: [] };
      all.set(id, series);
    }
    const approval = text(p.approval_status);
    const qualifier = Array.isArray(p.qualifier) ? p.qualifier.filter((q: unknown): q is string => typeof q === 'string') : [text(p.qualifier)].filter((q): q is string => q !== undefined);
    series.points.push({ t, v, q: [...(approval === 'Provisional' ? ['P'] : approval === 'Approved' ? ['A'] : []), ...qualifier] });
  }

  // A site can have multiple sensor series for one parameter. Keep a single series
  // to avoid mixing stage datums or double-counting the same rainfall interval.
  const selected = new Map<string, UsgsSeries>();
  for (const series of all.values()) {
    const unique = new Map(series.points.map((point) => [point.t, point]));
    series.points = [...unique.values()].sort((a, b) => a.t - b.t);
    const id = series.site + ':' + series.param;
    const previous = selected.get(id);
    const newest = series.points.at(-1)!.t;
    if (!previous || newest > previous.points.at(-1)!.t ||
        (newest === previous.points.at(-1)!.t && series.points.length > previous.points.length)) {
      selected.set(id, series);
    }
  }
  return [...selected.values()];
}

async function withNames(series: UsgsSeries[]) {
  const sites = await fetchUsgsSiteInfo(series.map((s) => s.site)).catch(() => new Map<string, UsgsSiteInfo>());
  for (const s of series) s.name = sites.get(s.site)?.name ?? s.name;
  return series;
}

export async function fetchUsgsLatest(): Promise<UsgsSeries[]> {
  return withNames(await readings('latest-continuous', {
    filter: watershedFilter, parameter_code: stageParams + ',00060', time: timeRange(168),
  }));
}

export function fetchUsgsRecentStage(): Promise<UsgsSeries[]> {
  return readings('continuous', { filter: watershedFilter, parameter_code: stageParams, time: timeRange(50) });
}

export function fetchUsgsSiteSeries(site: string, params: string[], hours: number): Promise<UsgsSeries[]> {
  return readings('continuous', {
    monitoring_location_id: 'USGS-' + site, parameter_code: params.join(','), time: timeRange(hours + 1),
  });
}

export async function fetchUsgsRain(): Promise<UsgsSeries[]> {
  return withNames(await readings('continuous', { bbox, parameter_code: '00045', time: timeRange(168) }));
}

export function fetchUsgsSiteInfo(sites: string[]): Promise<Map<string, UsgsSiteInfo>> {
  const ids = [...new Set(sites)].sort();
  return locationCache.get(ids.join(','), TTL.siteInfo, async () => {
    const result = new Map<string, UsgsSiteInfo>();
    for (let i = 0; i < ids.length; i += 90) {
      const id = ids.slice(i, i + 90).map((site) => 'USGS-' + site).join(',');
      for await (const feature of features('monitoring-locations', { id })) {
        const p = feature?.properties;
        const site = text(p?.monitoring_location_number);
        if (!site) continue;
        result.set(site, {
          site, name: text(p?.monitoring_location_name), altitude: number(p?.altitude),
          altitudeDatum: text(p?.vertical_datum), huc: text(p?.hydrologic_unit_code)?.slice(0, 8),
        });
      }
    }
    return result;
  });
}
