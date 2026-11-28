// The data engine: pulls every source through the adapters, merges them into stations and keeps
// the last good data when a source fails. The same code runs inside the Node server and, if the
// server is not running, directly in the browser.
import { FRESH_MAX_MIN, OLD_MAX_MIN, TREND_THRESHOLD_FT, TREND_WINDOW_H, TTL } from './config';
import { TtlCache, mapLimit } from './http';
import {
  categoryToSeverity,
  fetchNwpsDetail,
  fetchNwpsGauges,
  fetchNwpsStageflow,
  severityFromThresholds,
  stageDatumFromName,
  type NwpsDetail,
  type NwpsGauge,
  type NwpsStageflow,
} from './adapters/nwps';
import { fetchUsgsLatest, fetchUsgsRain, fetchUsgsRecentStage, fetchUsgsSiteInfo, fetchUsgsSiteSeries, type UsgsSeries, type UsgsSiteInfo } from './adapters/usgs';
import { alertMentionsStation, fetchNwsAlerts } from './adapters/nws';
import { VECTOR_LAYERS, fetchMainStem, fetchPointInfo, queryArcgisGeojson, type BBox } from './adapters/gis';
import type {
  Freshness,
  HistoryResponse,
  Measurement,
  OfficialAlert,
  PointInfo,
  RainGauge,
  SeriesPoint,
  Severity,
  Snapshot,
  SourceStatus,
  Station,
  StationDetail,
  StationGroup,
  Thresholds,
  WaterSurfaceElevation,
} from './types';

const MAIN_RE = /st\.? ?johns|lake george|lake harney|lake monroe/i;
const COASTAL_RE =
  /indian river|halifax|matanzas|mosquito|atlantic|tolomato|guana|haulover|canaveral|turning basin|nassau|mickler|bulow|ponce de leon|rose bay|pellicer|tide station|mizell|fort george|tiger point|sr a1a|turnbull|cedar creek \(in|banana river|fulton|tomoka|spruce creek|thomas creek/i;
const OTHER_BASIN_RE = /reedy|shingle|boggy|bonnet|lake marion|palatlakaha|haynes|weohyakapka|tiger creek|livingston|carter creek|green swamp|crane creek|eau gallie|turkey creek|sebastian|north canal|fellsmere|lake rosalie/i;

function groupFor(name: string, huc?: string): StationGroup {
  if (MAIN_RE.test(name)) return 'main';
  if (huc?.startsWith('030802')) return 'coastal';
  if (COASTAL_RE.test(name)) return 'coastal';
  if (OTHER_BASIN_RE.test(name)) return 'other';
  return 'tributary';
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bFl\b/g, 'FL')
    .replace(/\bSr\b/g, 'SR')
    .replace(/\bUs\b/g, 'US')
    .replace(/\b(Nr|Ab|Bl|Abv|Blw)\b/g, (m) => m.toLowerCase());

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function freshnessOf(time: string | number | undefined | null, now: number): { freshness: Freshness; ageMinutes?: number } {
  if (!time) return { freshness: 'none' };
  const t = typeof time === 'number' ? time : Date.parse(time);
  if (!isFinite(t)) return { freshness: 'none' };
  const age = Math.max(0, (now - t) / 60000);
  return { freshness: age <= FRESH_MAX_MIN ? 'fresh' : age <= OLD_MAX_MIN ? 'stale' : 'old', ageMinutes: Math.round(age) };
}

/** Changes between the latest point and the reading closest to N hours earlier. */
export function computeChanges(points: SeriesPoint[]) {
  const changes: Station['changes'] = {};
  if (points.length < 2) return { changes, trend: 'unknown' as const, ratePerHour: undefined };
  const last = points[points.length - 1];
  const tol: Record<number, number> = { 1: 20, 3: 40, 6: 60, 12: 90, 24: 120, 48: 180 };
  for (const h of [1, 3, 6, 12, 24, 48]) {
    const target = last.t - h * 3600_000;
    let best: SeriesPoint | null = null;
    let bestDt = Infinity;
    for (let i = points.length - 1; i >= 0; i--) {
      const dt = Math.abs(points[i].t - target);
      if (dt < bestDt) {
        bestDt = dt;
        best = points[i];
      }
      if (points[i].t < target - tol[h] * 60_000) break;
    }
    if (best && bestDt <= tol[h] * 60_000) (changes as any)[`h${h}`] = +(last.v - best.v).toFixed(2);
  }
  const ref = changes[`h${TREND_WINDOW_H}` as 'h3'];
  const trend = ref === undefined ? 'unknown' : ref > TREND_THRESHOLD_FT ? 'rising' : ref < -TREND_THRESHOLD_FT ? 'falling' : 'steady';
  const ratePerHour = changes.h1 !== undefined ? changes.h1 : changes.h3 !== undefined ? +(changes.h3 / 3).toFixed(3) : undefined;
  return { changes, trend: trend as Station['trend'], ratePerHour };
}

function seriesMax(points: SeriesPoint[]) {
  let best: SeriesPoint | null = null;
  for (const p of points) if (!best || p.v > best.v) best = p;
  return best;
}

export class DataEngine {
  readonly cache = new TtlCache();
  private status = new Map<string, SourceStatus>();
  private lastSnapshot: Snapshot | null = null;
  private warmed = false;
  constructor(private opts: { warmupWaitMs?: number } = {}) {}

  private async track<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    const s: SourceStatus = this.status.get(name) ?? { name, ok: false };
    s.lastAttempt = new Date().toISOString();
    try {
      const v = await fn();
      s.ok = true;
      s.lastSuccess = new Date().toISOString();
      s.error = undefined;
      this.status.set(name, s);
      return v;
    } catch (e) {
      s.ok = false;
      s.error = (e as Error)?.message ?? String(e);
      this.status.set(name, s);
      return fallback;
    }
  }

  private noteCacheError(name: string, key: string) {
    const err = this.cache.lastError(key);
    const s = this.status.get(name);
    if (s && err && Date.now() - err.at < 60_000) {
      s.ok = false;
      s.error = `${err.message} (showing last good data)`;
    }
  }

  // ---------- raw sources ----------
  nwpsList() {
    return this.track('NOAA NWPS gauge status', () => this.cache.get('nwpsList', TTL.nwpsList, fetchNwpsGauges), [] as NwpsGauge[]).then((v) => {
      this.noteCacheError('NOAA NWPS gauge status', 'nwpsList');
      return v.filter((g) => g.wfo !== 'TBW');
    });
  }
  usgsLatest() {
    return this.track('USGS instantaneous values', () => this.cache.get('usgsLatest', TTL.usgsLatest, fetchUsgsLatest), [] as UsgsSeries[]).then((v) => {
      this.noteCacheError('USGS instantaneous values', 'usgsLatest');
      return v;
    });
  }
  usgsRecent() {
    return this.track('USGS 48-hour stage history', () => this.cache.get('usgsRecent', TTL.usgsRecent, fetchUsgsRecentStage), [] as UsgsSeries[]);
  }
  rainSeries() {
    return this.track('USGS rain gauges', () => this.cache.get('rain', TTL.rain, fetchUsgsRain), [] as UsgsSeries[]).then((series) => {
      this.noteCacheError('USGS rain gauges', 'rain');
      return series;
    });
  }
  alerts() {
    return this.track('NWS active alerts', () => this.cache.get('alerts', TTL.alerts, fetchNwsAlerts), [] as OfficialAlert[]).then((v) => {
      this.noteCacheError('NWS active alerts', 'alerts');
      return v;
    });
  }
  detail(lid: string) {
    return this.cache.get(`nwpsDetail:${lid}`, TTL.nwpsDetail, () => fetchNwpsDetail(lid));
  }
  series(lid: string) {
    return this.cache.get(`nwpsSeries:${lid}`, TTL.nwpsSeries, () => fetchNwpsStageflow(lid));
  }
  siteInfo(sites: string[]) {
    const key = 'siteInfo';
    return this.track(
      'USGS site datums',
      () => this.cache.get(key, TTL.siteInfo, () => fetchUsgsSiteInfo(sites)),
      new Map<string, UsgsSiteInfo>(),
    );
  }

  /** Background refresh of per-gauge NWPS details and observation/forecast series. */
  private async refreshPerGauge(gauges: NwpsGauge[]) {
    const lids = gauges.map((g) => g.lid);
    let detailFail = 0;
    let seriesFail = 0;
    const needDetail = lids.filter((l) => {
      const p = this.cache.peek(`nwpsDetail:${l}`);
      return !p || Date.now() - p.at > TTL.nwpsDetail;
    });
    const needSeries = lids.filter((l) => {
      const p = this.cache.peek(`nwpsSeries:${l}`);
      return !p || Date.now() - p.at > TTL.nwpsSeries;
    });
    await Promise.all([
      mapLimit(needDetail, 6, (l) => this.detail(l).catch((e) => ((detailFail++), Promise.reject(e)))),
      mapLimit(needSeries, 6, (l) => this.series(l).catch((e) => ((seriesFail++), Promise.reject(e)))),
    ]);
    const now = new Date().toISOString();
    if (needDetail.length)
      this.status.set('NOAA NWPS thresholds & crests', {
        name: 'NOAA NWPS thresholds & crests',
        ok: detailFail < needDetail.length,
        lastSuccess: detailFail < needDetail.length ? now : this.status.get('NOAA NWPS thresholds & crests')?.lastSuccess,
        lastAttempt: now,
        error: detailFail ? `${detailFail} of ${needDetail.length} gauges failed to load` : undefined,
      });
    if (needSeries.length)
      this.status.set('NOAA NWPS observations & forecasts', {
        name: 'NOAA NWPS observations & forecasts',
        ok: seriesFail < needSeries.length,
        lastSuccess: seriesFail < needSeries.length ? now : this.status.get('NOAA NWPS observations & forecasts')?.lastSuccess,
        lastAttempt: now,
        error: seriesFail ? `${seriesFail} of ${needSeries.length} gauges failed to load` : undefined,
      });
  }

  private perGaugeRun: Promise<void> | null = null;

  // ---------- snapshot ----------
  async snapshot(): Promise<Snapshot> {
    // USGS answers slowly (15-30 s for the whole basin), so everything starts at once and the
    // slowest, least essential sources only hold up a refresh for a few seconds.
    const soft = <T>(p: Promise<T>, fallback: T, ms: number) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
    const gaugesP = this.nwpsList();
    const latestP = this.usgsLatest();
    const alertsP = this.alerts();
    const recentP = this.usgsRecent();
    const rainP = this.rainSeries();
    const gauges = await gaugesP;
    if (!this.perGaugeRun) {
      this.perGaugeRun = this.refreshPerGauge(gauges).finally(() => (this.perGaugeRun = null));
    }
    const [latest, alerts] = await Promise.all([latestP, alertsP]);
    const extraWait = this.warmed ? 1500 : 12000;
    const [recent, rainRaw] = await Promise.all([
      soft(recentP, this.cache.peek<UsgsSeries[]>('usgsRecent')?.value ?? [], extraWait),
      soft(rainP, this.cache.peek<UsgsSeries[]>('rain')?.value ?? [], extraWait),
    ]);
    if (!this.warmed) {
      // First snapshot: wait (up to 25 s) so thresholds and trends are there from the start.
      await Promise.race([this.perGaugeRun, new Promise((r) => setTimeout(r, this.opts.warmupWaitMs ?? 25000))]);
      this.warmed = true;
    }

    const now = Date.now();
    const usgsSites = [...new Set(latest.map((s) => s.site))];
    const siteInfo = usgsSites.length
      ? await soft(this.siteInfo(usgsSites), this.cache.peek<Map<string, UsgsSiteInfo>>('siteInfo')?.value ?? new Map<string, UsgsSiteInfo>(), extraWait)
      : new Map<string, UsgsSiteInfo>();

    const bySite = new Map<string, Map<string, UsgsSeries>>();
    for (const s of latest) {
      if (!bySite.has(s.site)) bySite.set(s.site, new Map());
      bySite.get(s.site)!.set(s.param, s);
    }
    const recentBySite = new Map<string, Map<string, UsgsSeries>>();
    for (const s of recent) {
      if (!recentBySite.has(s.site)) recentBySite.set(s.site, new Map());
      recentBySite.get(s.site)!.set(s.param, s);
    }
    const lastPt = (s?: UsgsSeries) => (s && s.points.length ? s.points[s.points.length - 1] : undefined);

    const stations: Station[] = [];
    const matchedUsgs = new Set<string>();

    for (const g of gauges) {
      const det = this.cache.peek<NwpsDetail>(`nwpsDetail:${g.lid}`)?.value;
      const ser = this.cache.peek<NwpsStageflow>(`nwpsSeries:${g.lid}`)?.value;
      // USGS partner site: from NWPS metadata, else the closest USGS site within 250 m.
      let usgsId = det?.usgsId;
      if (!usgsId) {
        let best = 250;
        for (const [site, params] of bySite) {
          const any = [...params.values()][0];
          const d = distanceM(g.lat, g.lon, any.lat, any.lon);
          if (d < best) {
            best = d;
            usgsId = site;
          }
        }
      }
      if (usgsId) matchedUsgs.add(usgsId);
      const usgs = usgsId ? bySite.get(usgsId) : undefined;

      // Current stage: NWPS status, or a newer point from the NWPS series (same datum).
      let stage: Measurement | null = null;
      if (g.observed.value !== null && g.observed.time) stage = { value: g.observed.value, unit: 'ft', time: g.observed.time, source: 'NOAA NWPS' };
      const serLast = ser?.observed[ser.observed.length - 1];
      if (serLast && (!stage || serLast.t > Date.parse(stage.time))) stage = { value: serLast.v, unit: 'ft', time: new Date(serLast.t).toISOString(), source: 'NOAA NWPS' };

      const nameDatum = stageDatumFromName(g.name);
      const stageDatum = nameDatum ? (nameDatum === 'MHHW' ? 'MHHW (tidal datum)' : nameDatum) : 'Local gauge datum';

      // Changes and trend from the NWPS observation series (same datum as the stage).
      let pts = ser?.observed ?? [];
      // If NWPS series unavailable, fall back to USGS recent when the USGS reading agrees with NWPS (same datum).
      const uStageLast = lastPt(usgs?.get('00065'));
      const sameDatum = !!(uStageLast && stage && Math.abs(uStageLast.v - stage.value) < 0.06);
      if (pts.length < 2 && sameDatum && usgsId) pts = recentBySite.get(usgsId)?.get('00065')?.points ?? [];
      if (stage && pts.length && Date.parse(stage.time) > pts[pts.length - 1].t) pts = [...pts, { t: Date.parse(stage.time), v: stage.value }];
      const { changes, trend, ratePerHour } = computeChanges(pts);

      // Flow: NWPS secondary, else USGS discharge.
      let flow: Measurement | null = null;
      const uFlow = lastPt(usgs?.get('00060'));
      if (uFlow) flow = { value: uFlow.v, unit: 'cfs', time: new Date(uFlow.t).toISOString(), source: `USGS ${usgsId}`, qualifiers: (uFlow as any).q };
      else if (g.observed.flow !== null && g.observed.time) flow = { value: g.observed.flow, unit: 'cfs', time: g.observed.time, source: 'NOAA NWPS' };

      const secondaryStage =
        uStageLast && stage && !sameDatum
          ? {
              value: uStageLast.v,
              unit: 'ft',
              time: new Date(uStageLast.t).toISOString(),
              source: `USGS ${usgsId}`,
              qualifiers: (uStageLast as any).q,
              note: 'USGS gauge height uses a different datum than the NWS stage; values are not directly comparable.',
            }
          : undefined;

      const thresholds = det?.thresholds ?? null;
      const fr = freshnessOf(stage?.time, now);
      let severity: Severity = 'unknown';
      let severityBasis = 'No current reading';
      if (stage && fr.freshness !== 'old') {
        const official = categoryToSeverity(g.observed.category);
        const usingListValue = g.observed.value === stage.value && g.observed.time === stage.time;
        if (official && usingListValue) {
          severity = official;
          severityBasis = 'Official NWS flood category (NWPS)';
        } else {
          const computed = severityFromThresholds(stage.value, thresholds);
          if (computed) {
            severity = computed;
            severityBasis = 'Computed from official NWS flood thresholds';
          } else severityBasis = thresholds ? 'Thresholds incomplete' : 'No published flood thresholds';
        }
      } else if (stage) severityBasis = 'Reading older than 24 h';
      if (!det?.inService && det) severityBasis = 'Gauge out of service';

      // Water-surface elevation in a geodetic datum, only when NWPS publishes the gauge-zero offset.
      let wse: WaterSurfaceElevation | null = null;
      if (stage) {
        if (nameDatum === 'NAVD88' || nameDatum === 'NGVD29') wse = { value: stage.value, datum: nameDatum, method: 'Stage is reported directly in this datum (NWPS)' };
        else {
          const d = det?.datums.find((x) => /NAVD ?88/i.test(x.abbrev)) ?? det?.datums.find((x) => /NGVD ?29/i.test(x.abbrev));
          if (d)
            wse = {
              value: +(stage.value + d.value).toFixed(2),
              datum: /NAVD/i.test(d.abbrev) ? 'NAVD88' : 'NGVD29',
              method: `Stage + gauge-zero elevation (${d.value} ft ${d.abbrev}) published by NWPS`,
            };
        }
        // Otherwise use the USGS gauge datum, but only when the USGS gauge height matches the NWS stage.
        const info = usgsId ? siteInfo.get(usgsId) : undefined;
        if (!wse && sameDatum && info?.altitude !== undefined && /NAVD|NGVD/.test(info.altitudeDatum ?? ''))
          wse = {
            value: +(stage.value + info.altitude).toFixed(2),
            datum: /NAVD/.test(info.altitudeDatum!) ? 'NAVD88' : 'NGVD29',
            method: `Stage + USGS gauge datum (${info.altitude} ft ${info.altitudeDatum}); USGS and NWS stages agree at this site`,
          };
      }

      let forecast: Station['forecast'] = null;
      if (ser && ser.forecast.length && ser.forecastIssued) {
        const crest = seriesMax(ser.forecast.filter((p) => p.t >= now - 3600_000));
        const last = ser.forecast[ser.forecast.length - 1];
        forecast = {
          issued: ser.forecastIssued,
          crest: crest ? { value: crest.v, time: new Date(crest.t).toISOString() } : undefined,
          last: { value: last.v, time: new Date(last.t).toISOString() },
          category: crest ? severityFromThresholds(crest.v, thresholds) ?? undefined : undefined,
        };
      }

      const flags: string[] = [];
      if (nameDatum === 'MHHW' || /tide/i.test(g.name)) flags.push('tidal');
      if (g.observed.category === 'out_of_service' || det?.inService === false) flags.push('out of service');
      if (flow?.qualifiers?.includes('e')) flags.push('flow estimated');
      if (flow?.qualifiers?.includes('P')) flags.push('provisional');

      const links = [{ label: 'NOAA NWPS gauge page', url: `https://water.noaa.gov/gauges/${g.lid.toLowerCase()}` }];
      if (usgsId) links.push({ label: `USGS ${usgsId} monitoring location`, url: `https://waterdata.usgs.gov/monitoring-location/USGS-${usgsId}/` });
      links.push({ label: `NWS ${g.wfo} office`, url: `https://www.weather.gov/${g.wfo.toLowerCase()}` });

      const cleanName = g.name.replace(/\s*\(in [A-Z0-9*]+\)/i, '');
      stations.push({
        id: `NWPS:${g.lid}`,
        lid: g.lid,
        usgsId,
        name: cleanName,
        lat: g.lat,
        lon: g.lon,
        group: groupFor(g.name, usgsId ? siteInfo.get(usgsId)?.huc : undefined),
        county: det?.county,
        sources: usgsId ? ['NOAA NWPS', 'USGS'] : ['NOAA NWPS'],
        stage,
        stageDatum,
        flow,
        secondaryStage,
        wse,
        thresholds,
        severity,
        severityBasis,
        trend,
        changes,
        ratePerHour,
        forecast,
        freshness: fr.freshness,
        ageMinutes: fr.ageMinutes,
        flags,
        links,
        officialAlertIds: alerts.filter((a) => a.isFlood && alertMentionsStation(a, cleanName)).map((a) => a.id),
        inService: !(det?.inService === false || g.observed.category === 'out_of_service'),
      });
    }

    // USGS sites that are not NWS forecast points.
    for (const [site, params] of bySite) {
      if (matchedUsgs.has(site)) continue;
      const any = [...params.values()][0];
      const st = params.get('00065') ?? params.get('62615') ?? params.get('62614');
      const fl = params.get('00060');
      if (!st && !fl) continue;
      const sp = lastPt(st);
      const fp = lastPt(fl);
      const info = siteInfo.get(site);
      const isLakeElev = st && st.param !== '00065';
      const stage: Measurement | null = sp ? { value: sp.v, unit: 'ft', time: new Date(sp.t).toISOString(), source: `USGS ${site}`, qualifiers: (sp as any).q } : null;
      const flow: Measurement | null = fp ? { value: fp.v, unit: 'cfs', time: new Date(fp.t).toISOString(), source: `USGS ${site}`, qualifiers: (fp as any).q } : null;
      let wse: WaterSurfaceElevation | null = null;
      if (stage && isLakeElev) wse = { value: stage.value, datum: st!.param === '62615' ? 'NAVD88' : 'NGVD29', method: 'USGS lake/reservoir elevation parameter' };
      else if (stage && info?.altitude !== undefined && /NAVD|NGVD/.test(info.altitudeDatum ?? ''))
        wse = {
          value: +(stage.value + info.altitude).toFixed(2),
          datum: /NAVD/.test(info.altitudeDatum!) ? 'NAVD88' : 'NGVD29',
          method: `Gauge height + USGS gauge datum (${info.altitude} ft ${info.altitudeDatum})`,
        };
      const rpts = recentBySite.get(site)?.get(st?.param ?? '00065')?.points ?? [];
      const pts = sp && rpts.length && sp.t > rpts[rpts.length - 1].t ? [...rpts, sp] : rpts;
      const { changes, trend, ratePerHour } = computeChanges(pts);
      const fr = freshnessOf(stage?.time ?? flow?.time, now);
      const flags: string[] = [];
      const q = [...(stage?.qualifiers ?? []), ...(flow?.qualifiers ?? [])];
      if (q.includes('e')) flags.push('estimated');
      if (q.includes('P')) flags.push('provisional');
      if (/tide|\(in mhhw\)/i.test(any.name)) flags.push('tidal');
      if (flow && flow.value < 0) flags.push('reverse flow');
      stations.push({
        id: `USGS:${site}`,
        usgsId: site,
        name: titleCase(any.name),
        lat: any.lat,
        lon: any.lon,
        group: groupFor(any.name, info?.huc),
        sources: ['USGS'],
        stage,
        stageDatum: isLakeElev ? (st!.param === '62615' ? 'NAVD88' : 'NGVD29') : 'USGS gauge datum',
        flow,
        wse,
        thresholds: null,
        severity: 'unknown',
        severityBasis: stage ? 'No published NWS flood thresholds for this USGS site' : 'Discharge only - no stage reading',
        trend,
        changes,
        ratePerHour,
        forecast: null,
        freshness: fr.freshness,
        ageMinutes: fr.ageMinutes,
        flags,
        links: [{ label: `USGS ${site} monitoring location`, url: `https://waterdata.usgs.gov/monitoring-location/USGS-${site}/` }],
        officialAlertIds: [],
        inService: true,
      });
    }

    // Rain gauges
    const rainBySite = new Map<string, UsgsSeries>();
    for (const s of rainRaw) if (s.param === '00045') rainBySite.set(s.site, s);
    const rain: RainGauge[] = [...rainBySite.values()]
      .filter((s) => s.points.length > 0)
      .map((s) => {
        const sum = (h: number) => {
          const from = now - h * 3600_000;
          const points = s.points.filter((p) => p.t > from && p.t <= now);
          return points.length ? +points.reduce((a, p) => a + p.v, 0).toFixed(2) : undefined;
        };
        const last = s.points[s.points.length - 1];
        return {
          id: `USGS:${s.site}`,
          name: titleCase(s.name),
          lat: s.lat,
          lon: s.lon,
          source: `USGS ${s.site} (00045)`,
          lastTime: new Date(last.t).toISOString(),
          totals: { h1: sum(1), h6: sum(6), h24: sum(24), h72: sum(72), d7: sum(168) },
          freshness: freshnessOf(last.t, now).freshness,
        };
      });

    const sources: SourceStatus[] = [
      ...this.status.values(),
      {
        name: 'SJRWMD real-time hydrologic data',
        ok: false,
        note: 'No public machine-readable feed found (website blocks automated access). SJRWMD-operated gauges that are shared with USGS/NWS appear through those sources.',
      },
    ];

    const snap: Snapshot = { generatedAt: new Date().toISOString(), stations, rain, alerts, sources };
    this.lastSnapshot = snap;
    return snap;
  }

  private findStation(id: string): Station | undefined {
    return this.lastSnapshot?.stations.find((s) => s.id === id);
  }

  // ---------- per-station ----------
  async history(stationId: string, hours: number): Promise<HistoryResponse> {
    if (!this.lastSnapshot) await this.snapshot();
    const st = this.findStation(stationId);
    if (!st) throw new Error(`Unknown station ${stationId}`);
    const now = Date.now();
    const from = now - hours * 3600_000;
    const notes: string[] = [];
    const res: HistoryResponse = { stationId, rangeHours: hours, stage: null, flow: null, forecast: null, thresholds: st.thresholds, notes };

    const usgsParams = (params: string[]) =>
      this.cache.get(`hist:${st.usgsId}:${params.join(',')}:${hours}`, TTL.history, () => fetchUsgsSiteSeries(st.usgsId!, params, hours));

    if (st.lid) {
      let ser: NwpsStageflow | undefined;
      try {
        ser = await this.series(st.lid);
      } catch (e) {
        notes.push(`NOAA NWPS series unavailable: ${(e as Error).message}`);
      }
      if (ser) {
        const pts = ser.observed.filter((p) => p.t >= from);
        res.stage = { points: pts, source: 'NOAA NWPS observed', datum: st.stageDatum, unit: 'ft' };
        const firstObs = ser.observed[0]?.t;
        if (firstObs && firstObs > from + 6 * 3600_000) {
          notes.push(`NOAA NWPS publishes about ${Math.round((now - firstObs) / 86400_000)} days of observations for this gauge.`);
        }
        if (ser.forecast.length && ser.forecastIssued) res.forecast = { points: ser.forecast, issued: ser.forecastIssued, source: 'NWS Southeast River Forecast Center via NWPS' };
      }
      if (st.usgsId) {
        try {
          const needStage = hours > 24 * 25 && !st.secondaryStage; // longer record from USGS when datums match
          const series = await usgsParams(needStage ? ['00065', '00060'] : ['00060']);
          const q = series.find((s) => s.param === '00060');
          if (q?.points.length) res.flow = { points: q.points.map(({ t, v }) => ({ t, v })), source: `USGS ${st.usgsId}`, unit: 'cfs' };
          const gh = series.find((s) => s.param === '00065');
          if (needStage && gh && gh.points.length) {
            const lastU = gh.points[gh.points.length - 1].v;
            if (st.stage && Math.abs(lastU - st.stage.value) < 0.06) {
              res.stage = { points: gh.points.map(({ t, v }) => ({ t, v })), source: `USGS ${st.usgsId} (same datum as NWS stage)`, datum: st.stageDatum, unit: 'ft' };
              notes.push('Longer record supplied by USGS; its gauge height matches the NWS stage at this site.');
            } else notes.push('A longer USGS record exists but uses a different datum, so it is not merged.');
          }
        } catch (e) {
          notes.push(`USGS record unavailable: ${(e as Error).message}`);
        }
      }
    } else if (st.usgsId) {
      try {
        const series = await usgsParams(['00065', '62614', '62615', '00060']);
        const gh = series.find((s) => s.param === '00065') ?? series.find((s) => s.param === '62615') ?? series.find((s) => s.param === '62614');
        const q = series.find((s) => s.param === '00060');
        if (gh?.points.length) res.stage = { points: gh.points.map(({ t, v }) => ({ t, v })), source: `USGS ${st.usgsId}`, datum: st.stageDatum, unit: 'ft' };
        if (q?.points.length) res.flow = { points: q.points.map(({ t, v }) => ({ t, v })), source: `USGS ${st.usgsId}`, unit: 'cfs' };
      } catch (e) {
        notes.push(`USGS record unavailable: ${(e as Error).message}`);
      }
      notes.push('No official NWS forecast is issued for this USGS site.');
    }
    if (!res.stage && !res.flow) notes.push('No measurements available for this range.');
    return res;
  }

  async stationDetail(stationId: string): Promise<StationDetail> {
    if (!this.lastSnapshot) await this.snapshot();
    const st = this.findStation(stationId);
    if (!st) throw new Error(`Unknown station ${stationId}`);
    if (!st.lid) return { stationId, historicCrests: [], recentCrests: [], impacts: [], datums: [] };
    const d = await this.detail(st.lid);
    return {
      stationId,
      historicCrests: [...d.historicCrests].sort((a, b) => b.stage - a.stage).slice(0, 12),
      recentCrests: d.recentCrests.slice(0, 10),
      impacts: [...d.impacts].sort((a, b) => b.stage - a.stage),
      datums: d.datums,
      forecastReliability: d.forecastReliability,
      upstream: d.upstream,
      downstream: d.downstream,
      hydrographImage: d.hydrographImage,
      description: d.description,
    };
  }

  // ---------- GIS ----------
  async layer(id: string, bbox: BBox | null, zoom: number): Promise<GeoJSON.FeatureCollection> {
    const def = VECTOR_LAYERS[id];
    if (!def) throw new Error(`Unknown layer ${id}`);
    if (def.wholeDataset) return this.cache.get(`layer:${id}`, TTL.gis, () => queryArcgisGeojson(def, null, 10));
    if (!bbox) throw new Error('bbox required');
    // Snap to a grid so nearby map views share cache entries.
    const g = zoom >= 13 ? 0.02 : 0.05;
    const sb: BBox = [Math.floor(bbox[0] / g) * g, Math.floor(bbox[1] / g) * g, Math.ceil(bbox[2] / g) * g, Math.ceil(bbox[3] / g) * g];
    const z = Math.min(16, Math.floor(zoom));
    return this.cache.get(`layer:${id}:${sb.map((n) => n.toFixed(2)).join(',')}:${z}`, TTL.gis, () => queryArcgisGeojson(def, sb, z));
  }

  mainStem() {
    return this.cache.get('mainstem', 24 * 3600_000, fetchMainStem);
  }

  point(lat: number, lon: number): Promise<PointInfo> {
    return this.cache.get(`point:${lat.toFixed(5)},${lon.toFixed(5)}`, 3600_000, () => fetchPointInfo(lat, lon));
  }
}
