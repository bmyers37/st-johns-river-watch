// National Weather Service active alerts (api.weather.gov). These are OFFICIAL warnings and are
// always shown separately from alerts the app generates itself.
import { ALERT_COUNTIES, ALERT_EVENT_PATTERN, ENDPOINTS } from '../config';
import { fetchJson, isObj } from '../http';
import type { OfficialAlert } from '../types';

const countyRe = new RegExp(`\\b(${ALERT_COUNTIES.map((c) => c.replace('.', '\\.?')).join('|')})\\b`, 'i');

export async function fetchNwsAlerts(): Promise<OfficialAlert[]> {
  const j = await fetchJson(ENDPOINTS.nwsAlerts, (x): x is { features: any[] } => isObj(x) && Array.isArray((x as any).features), {
    headers: { Accept: 'application/geo+json' },
  });
  return j.features
    .filter((f) => isObj(f?.properties))
    .map((f) => {
      const p = f.properties;
      return {
        id: String(p.id ?? f.id),
        event: String(p.event ?? ''),
        severity: String(p.severity ?? ''),
        headline: String(p.headline ?? p.event ?? ''),
        areaDesc: String(p.areaDesc ?? ''),
        sent: String(p.sent ?? ''),
        expires: p.ends || p.expires || undefined,
        sender: String(p.senderName ?? 'National Weather Service'),
        description: String(p.description ?? ''),
        instruction: p.instruction || undefined,
        url: typeof f.id === 'string' ? f.id : 'https://alerts.weather.gov',
        geometry: f.geometry ?? null,
        isFlood: /flood|hydrologic/i.test(p.event ?? ''),
        isWarning: /warning/i.test(p.event ?? ''),
      } satisfies OfficialAlert;
    })
    .filter((a) => countyRe.test(a.areaDesc) && ALERT_EVENT_PATTERN.test(a.event));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bst\.?\s/g, 'st ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Links a river-point alert to a station when the alert text names the forecast point. */
export function alertMentionsStation(alert: OfficialAlert, stationName: string): boolean {
  const n = norm(stationName).replace(/\s\d+[nsew]+$/, '');
  if (n.length < 10) return false;
  return norm(`${alert.headline} ${alert.description}`).includes(n);
}
