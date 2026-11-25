import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react';
import type { PointInfo, Snapshot, Station } from '../shared/types';
import { getLayer, getMainStem, getPoint } from '../lib/api';
import { SEVERITY, TREND, bearingName, distanceKm, localTime } from '../lib/format';
import { steepestDescent, type DescentResult } from '../lib/terrain';
import { NHD_FTYPES, STRUCTURE_TYPES } from './mapStyle';
import { PanelShell, Section } from './StationPanel';

interface Props {
  pin: { lat: number; lon: number };
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (name: string) => void;
  saved: boolean;
  onGeometry: (g: { nhd: GeoJSON.FeatureCollection | null; terrain: [number, number][] | null }) => void;
  onSelectStation: (id: string) => void;
}

interface Infra {
  kind: string;
  name: string;
  detail: string;
  km: number;
  source: string;
}

function nearestKm(lat: number, lon: number, g: GeoJSON.Geometry | null): number {
  let best = Infinity;
  if (!g) return best;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') best = Math.min(best, distanceKm(lat, lon, c[1], c[0]));
    else c.forEach(visit);
  };
  if ('coordinates' in g) visit(g.coordinates);
  return best;
}

function lineKm(fc: GeoJSON.Feature[]): number {
  let km = 0;
  for (const f of fc)
    if (f.geometry.type === 'LineString') {
      const c = f.geometry.coordinates;
      for (let i = 1; i < c.length; i++) km += distanceKm(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]);
    }
  return km;
}

const Loading = ({ label }: { label: string }) => (
  <div className="faint flex items-center gap-2 text-[12px]">
    <Loader2 size={13} className="animate-spin" /> {label}
  </div>
);

export default function PinPanel({ pin, snapshot, onClose, onSave, saved, onGeometry, onSelectStation }: Props) {
  const [info, setInfo] = useState<PointInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [infra, setInfra] = useState<Infra[] | null>(null);
  const [descent, setDescent] = useState<DescentResult | null>(null);
  const [mainStem, setMainStem] = useState<GeoJSON.FeatureCollection | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    getPoint(pin.lat, pin.lon)
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setInfoErr(e.message));
    getMainStem()
      .then((m) => alive && setMainStem(m))
      .catch(() => {});
    steepestDescent(pin.lat, pin.lon)
      .then((d) => alive && setDescent(d))
      .catch(() => alive && setDescent({ path: [], elevations: [], stopReason: 'Elevation tiles unavailable', lengthM: 0 }));
    const d = 0.03;
    const bbox: [number, number, number, number] = [pin.lon - d, pin.lat - d, pin.lon + d, pin.lat + d];
    const small: [number, number, number, number] = [pin.lon - 0.012, pin.lat - 0.012, pin.lon + 0.012, pin.lat + 0.012];
    Promise.allSettled([getLayer('ditches', bbox, 14), getLayer('structures', null, 10), getLayer('nhdPoints', bbox, 14), getLayer('nhdFlowlines', bbox, 14), getLayer('tvStructures', small, 15), getLayer('tvChannels', small, 15)]).then((r) => {
      if (!alive) return;
      const out: Infra[] = [];
      const fcs = r.map((x) => (x.status === 'fulfilled' ? x.value.features : []));
      for (const f of fcs[0]) {
        const p: any = f.properties ?? {};
        out.push({ kind: 'Drainage ditch', name: p.name || 'Unnamed ditch', detail: `${p.type ?? ''}${p.flow_dir ? ` · mapped flow ${p.flow_dir}` : ''}`, km: nearestKm(pin.lat, pin.lon, f.geometry), source: 'Brevard County PW' });
      }
      for (const f of fcs[1]) {
        const p: any = f.properties ?? {};
        const km = nearestKm(pin.lat, pin.lon, f.geometry);
        if (km < 5) out.push({ kind: STRUCTURE_TYPES[p.TYPE] ?? 'Control structure', name: p.NAME || 'Unnamed', detail: 'Operational status unknown', km, source: 'SJRWMD' });
      }
      for (const f of fcs[2]) {
        const p: any = f.properties ?? {};
        const ft = p.ftype ?? p.FTYPE;
        out.push({ kind: NHD_FTYPES[ft] ?? 'NHD structure', name: p.gnis_name || p.GNIS_NAME || 'Unnamed', detail: 'Operational status unknown', km: nearestKm(pin.lat, pin.lon, f.geometry), source: 'USGS NHD' });
      }
      for (const f of fcs[3]) {
        const p: any = f.properties ?? {};
        if (![336, 428, 420].includes(p.ftype)) continue;
        out.push({ kind: NHD_FTYPES[p.ftype], name: p.gnis_name || 'Unnamed', detail: 'NHD mapped channel', km: nearestKm(pin.lat, pin.lon, f.geometry), source: 'USGS NHD' });
      }
      for (const f of fcs[4]) {
        const q: any = f.properties ?? {};
        const t = q.Hydraulic_Type_Desc || 'Structure';
        if (!/control|weir|baffle|diversion|bridge/i.test(t)) continue; // skip the many street inlets
        const elev = q.Invert_Elev ? `invert ${q.Invert_Elev} ft${q.Elev_Datum && q.Elev_Datum !== 'Not Populated' ? ' ' + q.Elev_Datum : ' (datum not recorded)'}` : 'no elevation recorded';
        out.push({ kind: t, name: q.FieldID || 'City structure', detail: `${elev}${/control|weir/i.test(t) ? ' · operational status unknown' : ''}`, km: nearestKm(pin.lat, pin.lon, f.geometry), source: 'City of Titusville' });
      }
      for (const f of fcs[5]) {
        const q: any = f.properties ?? {};
        out.push({ kind: 'Stormwater channel', name: q.FacilityID || 'City channel', detail: [q.Subtype, q.Width_Feet ? `${q.Width_Feet} ft wide` : ''].filter(Boolean).join(' · ') || 'City channel', km: nearestKm(pin.lat, pin.lon, f.geometry), source: 'City of Titusville' });
      }
      const uniq = new Map<string, Infra>();
      for (const i of out.sort((a, b) => a.km - b.km)) {
        const k = `${i.kind}|${i.name}`;
        if (!uniq.has(k) || i.name === 'Unnamed' || i.name === 'Unnamed ditch') uniq.set(k + (i.name.startsWith('Unnamed') ? i.km : ''), i);
      }
      setInfra([...uniq.values()].filter((i) => i.km < 3).slice(0, 14));
    });
    return () => {
      alive = false;
    };
  }, [pin.lat, pin.lon]);

  useEffect(() => {
    onGeometry({ nhd: info?.hydrography.downstream ?? null, terrain: descent?.path ?? null });
  }, [info, descent, onGeometry]);

  const nearest = useMemo(
    () =>
      snapshot.stations
        .filter((s) => s.group !== 'other' && (s.stage || s.flow))
        .map((s) => ({ s, km: distanceKm(pin.lat, pin.lon, s.lat, s.lon) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 6),
    [snapshot, pin],
  );

  // Where the mapped (NHDPlus) path meets the St. Johns main stem.
  const junction = useMemo(() => {
    const path = info?.hydrography.downstream;
    if (!path || !mainStem) return null;
    const ms = new Set(mainStem.features.map((f) => String((f.properties as any)?.nhdplus_comid)));
    const off = path.features.filter((f) => !ms.has(String((f.properties as any)?.nhdplus_comid)));
    const on = path.features.filter((f) => ms.has(String((f.properties as any)?.nhdplus_comid)));
    if (!on.length) {
      const last = path.features[path.features.length - 1];
      const c = last && last.geometry.type === 'LineString' ? last.geometry.coordinates[last.geometry.coordinates.length - 1] : null;
      return { reaches: false as const, km: lineKm(path.features), end: c };
    }
    // the main-stem segment closest to the pin is where it joins
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const f of on)
      if (f.geometry.type === 'LineString')
        for (const c of f.geometry.coordinates) {
          const d = distanceKm(pin.lat, pin.lon, c[1], c[0]);
          if (d < bd) {
            bd = d;
            best = [c[0], c[1]];
          }
        }
    const mainSt = snapshot.stations.filter((s) => s.group === 'main' && s.stage);
    const station = best ? mainSt.map((s) => ({ s, km: distanceKm(best![1], best![0], s.lat, s.lon) })).sort((a, b) => a.km - b.km)[0] : null;
    return { reaches: true as const, km: lineKm(off), at: best, station };
  }, [info, mainStem, snapshot, pin]);

  const ground = info?.groundElevation?.value;
  const comparable = useMemo(() => {
    const list = snapshot.stations
      .filter((s) => s.group !== 'other' && s.wse && s.freshness !== 'old' && s.freshness !== 'none')
      .map((s) => ({ s, km: distanceKm(pin.lat, pin.lon, s.lat, s.lon) }))
      .filter((x) => x.km < 60)
      .sort((a, b) => a.km - b.km);
    return { navd: list.filter((x) => x.s.wse!.datum === 'NAVD88').slice(0, 6), other: list.filter((x) => x.s.wse!.datum !== 'NAVD88').slice(0, 4) };
  }, [snapshot, pin]);

  const ring = info?.ring ?? [];
  const ringVals = ring.filter((r) => r.value !== null).map((r) => r.value!);
  const lowest = ring.filter((r) => r.value !== null).sort((a, b) => a.value! - b.value!)[0];

  // Main-stem water-surface profile (only NAVD88 values; datums are never mixed).
  const profile = snapshot.stations
    .filter((s) => s.group === 'main' && s.wse?.datum === 'NAVD88' && s.freshness !== 'old' && !s.flags.includes('tidal'))
    .sort((a, b) => a.lat - b.lat);
  // The headline comparison only uses the gauge where the mapped path meets the river (or, without a
  // mapped junction, the nearest main-stem gauge) and only when it reports a NAVD88 water surface.
  // Gauges up- or downstream of that point are listed for reference, never used for the verdict.
  const junctionStation: Station | undefined = junction?.reaches
    ? junction.station?.s
    : snapshot.stations
        .filter((s) => s.group === 'main' && s.stage)
        .map((s) => ({ s, km: distanceKm(pin.lat, pin.lon, s.lat, s.lon) }))
        .sort((a, b) => a.km - b.km)[0]?.s;
  const receiving: Station | undefined = junctionStation?.wse?.datum === 'NAVD88' && junctionStation.freshness !== 'old' ? junctionStation : undefined;
  const refLat = junction?.reaches && junction.at ? junction.at[1] : junctionStation?.lat;
  const relation = (s: Station) => (s.group !== 'main' || refLat === undefined ? 'nearby' : s.lat < refLat - 0.01 ? 'upstream' : s.lat > refLat + 0.01 ? 'downstream' : 'at junction');

  return (
    <PanelShell
      onClose={onClose}
      title="Local drainage analysis"
      sub={
        <>
          Pin at {pin.lat.toFixed(5)}°N, {Math.abs(pin.lon).toFixed(5)}°W · estimates are not engineering assessments
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        {saved ? (
          <span className="pill" style={{ background: 'rgba(16,185,129,.15)', color: '#34d399' }}>
            <Check size={12} /> Saved location
          </span>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this location (e.g. Home)"
              aria-label="Location name"
              className="flex-1 rounded-lg border bg-transparent px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
              style={{ borderColor: 'var(--border)' }}
            />
            <button className="btn" onClick={() => onSave(name.trim() || `Pin ${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}`)}>
              <Save size={13} /> Save
            </button>
          </>
        )}
      </div>

      <Section title="Ground elevation">
        {!info && !infoErr ? (
          <Loading label="Asking the USGS elevation service…" />
        ) : ground !== undefined ? (
          <div className="card p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-semibold leading-none tabular-nums">{ground.toFixed(1)}</span>
              <span className="muted">ft NAVD88</span>
              <span className="pill ml-auto" style={{ background: 'rgba(59,130,246,.15)', color: '#93c5fd' }}>
                estimated
              </span>
            </div>
            <div className="faint mt-1 text-[10.5px]">{info!.groundElevation!.source}. Bare-earth model value; a survey can differ by a foot or more.</div>
          </div>
        ) : (
          <div className="text-[12px] text-amber-400">Ground elevation unavailable {infoErr ?? info?.errors.join('; ')}</div>
        )}
      </Section>

      <Section title="Surrounding terrain (USGS 3DEP)">
        {!info ? (
          <Loading label="Sampling 16 points around the pin…" />
        ) : ringVals.length === 0 ? (
          <div className="faint text-[12px]">Terrain samples unavailable.</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1 text-center text-[11px] tabular-nums">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((b) => {
                const near = ring.find((r) => r.bearing === b && r.distanceM === 150)?.value;
                const far = ring.find((r) => r.bearing === b && r.distanceM === 400)?.value;
                const low = lowest?.bearing === b;
                return (
                  <div key={b} className="card px-1 py-1" style={low ? { borderColor: '#fb923c' } : undefined}>
                    <div className="faint text-[10px]">{bearingName(b)}</div>
                    <div>{near?.toFixed(1) ?? '—'}</div>
                    <div className="faint">{far?.toFixed(1) ?? '—'}</div>
                  </div>
                );
              })}
            </div>
            <div className="faint mt-1 text-[10.5px]">
              ft NAVD88 at 150 m / 400 m. Range {Math.min(...ringVals).toFixed(1)}–{Math.max(...ringVals).toFixed(1)} ft. Lowest ground nearby: {lowest ? `${bearingName(lowest.bearing)} (${lowest.distanceM} m)` : '—'}.
            </div>
          </>
        )}
      </Section>

      <Section title="Downstream drainage paths">
        <div className="card mb-2 p-2.5 text-[12px]">
          <div className="flex items-center gap-2 font-semibold">
            <span className="h-1 w-5 rounded" style={{ background: '#60a5fa' }} /> Mapped hydrography path
            <span className="pill ml-auto" style={{ background: 'rgba(96,165,250,.15)', color: '#93c5fd' }}>
              mapped (NHDPlus)
            </span>
          </div>
          {!info ? (
            <Loading label="Tracing the USGS NHDPlus network…" />
          ) : info.hydrography.downstream ? (
            <div className="mt-1 leading-snug">
              {junction?.reaches ? (
                <>
                  Joins the <b>St. Johns River</b> after about <b>{junction.km.toFixed(1)} km</b> of mapped channels
                  {junction.station && (
                    <>
                      , near{' '}
                      <button className="accent underline" onClick={() => onSelectStation(junction.station!.s.id)}>
                        {junction.station.s.name}
                      </button>
                    </>
                  )}
                  .
                </>
              ) : junction ? (
                <>Follows {junction.km.toFixed(1)} km of mapped channels and does not reach the St. Johns main stem within 150 km (it may drain to the Indian River Lagoon or the coast).</>
              ) : (
                'Path found.'
              )}
              <div className="faint mt-1 text-[10.5px]">{info.hydrography.note}</div>
            </div>
          ) : (
            <div className="faint mt-1">{info.hydrography.note}</div>
          )}
        </div>
        <div className="card p-2.5 text-[12px]">
          <div className="flex items-center gap-2 font-semibold">
            <span className="h-1 w-5 rounded" style={{ background: 'repeating-linear-gradient(90deg,#fb923c 0 5px,transparent 5px 9px)' }} /> Terrain-based estimate
            <span className="pill ml-auto" style={{ background: 'rgba(251,146,60,.15)', color: '#fdba74' }}>
              estimate
            </span>
          </div>
          {!descent ? (
            <Loading label="Following the steepest downhill path…" />
          ) : (
            <div className="mt-1 leading-snug">
              {descent.path.length > 1 ? (
                <>
                  Surface runoff would head <b>{bearingName((Math.atan2(descent.path[descent.path.length - 1][0] - pin.lon, descent.path[descent.path.length - 1][1] - pin.lat) * 180) / Math.PI)}</b> for about{' '}
                  <b>{(descent.lengthM / 1000).toFixed(2)} km</b>, dropping {(descent.elevations[0] - descent.elevations[descent.elevations.length - 1]).toFixed(1)} ft.
                </>
              ) : (
                'No downhill direction found at this point.'
              )}
              <div className="faint mt-1 text-[10.5px]">
                {descent.stopReason}. Steepest descent on a ~10 m elevation model (AWS Terrain Tiles from USGS 3DEP). It cannot see culverts, pipes, pumps or small ditches.
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Backwater & gravity drainage check">
        {ground === undefined ? (
          <div className="faint text-[12px]">{info ? 'Needs the ground elevation, which is unavailable.' : 'Waiting for ground elevation…'}</div>
        ) : (
          <>
            {!receiving && (
              <div className="card mb-2 p-3 text-[12px]">
                <div className="font-semibold">No like-for-like comparison possible here</div>
                <div className="mt-1 leading-snug">
                  {junctionStation ? (
                    <>
                      The gauge where this drainage meets the river, <b>{junctionStation.name}</b>,{' '}
                      {junctionStation.wse ? `reports its water surface in ${junctionStation.wse.datum}` : 'has no published water-surface elevation (stage only, local gauge datum)'}, while ground elevation is in NAVD88.
                    </>
                  ) : (
                    'No main-stem gauge with a current reading was found.'
                  )}{' '}
                  Different datums are not compared, and values from gauges up- or downstream are not substituted, because the river surface slopes between gauges.
                </div>
              </div>
            )}
            {receiving && (
              (() => {
                const margin = ground - receiving.wse!.value;
                const color = margin < 0 ? '#f87171' : margin < 2 ? '#fb923c' : '#34d399';
                return (
                  <div className="card mb-2 p-3 text-[12px]" style={{ borderColor: color }}>
                    <div className="flex items-center gap-2 font-semibold" style={{ color }}>
                      {margin < 2 && <AlertTriangle size={14} />}
                      {margin < 0
                        ? 'River water surface is above the ground here'
                        : margin < 2
                          ? 'Little height left for gravity drainage'
                          : 'Ground is well above the river water surface'}
                    </div>
                    <div className="mt-1 leading-snug">
                      Ground {ground.toFixed(1)} ft vs. {receiving.name} water surface {receiving.wse!.value.toFixed(2)} ft NAVD88 (measured {localTime(receiving.stage?.time)}) ={' '}
                      <b>{margin >= 0 ? `${margin.toFixed(1)} ft above` : `${Math.abs(margin).toFixed(1)} ft below`}</b> the river.
                      {margin < 2 && ' High receiving water can slow or back up gravity-fed ditches and culverts that discharge toward it.'}
                    </div>
                    <div className="faint mt-1 text-[10.5px]">Indicator only: the water surface between the gauge and this point is not measured, and local structures (culverts, flap gates, pumps) are not modelled.</div>
                  </div>
                );
              })()
            )}
            {comparable.navd.length > 0 && (
            <table className="w-full text-[11.5px] tabular-nums">
              <caption className="faint pb-1 text-left text-[10.5px]">Reference only - other NAVD88 gauges within 60 km (not the water level at this location)</caption>
              <thead className="faint text-left text-[10px] uppercase">
                <tr>
                  <th className="py-1">Gauge (NAVD88 only)</th>
                  <th className="text-right">Water surface</th>
                  <th className="text-right">Ground − water</th>
                </tr>
              </thead>
              <tbody>
                {comparable.navd.map(({ s, km }) => (
                  <tr key={s.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-1">
                      <button className="text-left hover:text-[var(--accent)]" onClick={() => onSelectStation(s.id)}>
                        {s.name}
                      </button>
                      <span className="faint">
                        {' '}
                        · {km.toFixed(1)} km · {relation(s)}
                      </span>
                    </td>
                    <td className="text-right">{s.wse!.value.toFixed(2)} ft</td>
                    <td className="text-right" style={{ color: ground - s.wse!.value < 2 ? '#fb923c' : undefined }}>
                      {(ground - s.wse!.value).toFixed(1)} ft
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </>
        )}
        {comparable.other.length > 0 && (
          <div className="faint mt-1.5 text-[10.5px]">
            Not compared (different datum): {comparable.other.map((x) => `${x.s.name} (${x.s.wse!.datum})`).join(', ')}.
          </div>
        )}
        {profile.length >= 2 && (
          <div className="mt-2 text-[11.5px]">
            <div className="label-xs mb-1">Main-stem water-surface profile (NAVD88, upstream → downstream)</div>
            {profile.map((s, i) => {
              const next = profile[i + 1];
              const flat = next && next.wse!.value >= s.wse!.value - 0.05;
              return (
                <div key={s.id} className="flex justify-between">
                  <span>{s.name}</span>
                  <span className="tabular-nums">
                    {s.wse!.value.toFixed(2)} ft{flat && <span className="text-amber-400"> · no fall to next gauge</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Nearest monitoring stations">
        <div className="space-y-1">
          {nearest.map(({ s, km }) => (
            <button key={s.id} onClick={() => onSelectStation(s.id)} className="card flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:border-[var(--border-strong)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEVERITY[s.severity].color }} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="tabular-nums">{s.stage ? `${s.stage.value.toFixed(2)} ft ${TREND[s.trend].glyph}` : '—'}</span>
              <span className="faint w-14 text-right tabular-nums">{km.toFixed(1)} km</span>
            </button>
          ))}
        </div>
        <div className="faint mt-1 text-[10.5px]">Stages are in each gauge's own datum and are not comparable with each other or with ground elevation.</div>
      </Section>

      <Section title="Nearby drainage infrastructure (within 3 km)">
        {!infra ? (
          <Loading label="Querying City of Titusville, Brevard County, SJRWMD and USGS NHD…" />
        ) : infra.length === 0 ? (
          <div className="faint text-[12px]">No mapped ditches, canals or control structures found within 3 km in the public inventories.</div>
        ) : (
          <div className="space-y-1">
            {infra.map((i, k) => (
              <div key={k} className="flex items-start gap-2 border-b py-1 text-[11.5px]" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.name}</div>
                  <div className="faint text-[10.5px]">
                    {i.kind} · {i.detail} · {i.source}
                  </div>
                </div>
                <span className="tabular-nums">{i.km < 1 ? `${Math.round(i.km * 1000)} m` : `${i.km.toFixed(1)} km`}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </PanelShell>
  );
}
