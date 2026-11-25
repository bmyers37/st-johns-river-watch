import { CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import { localTime, timeAgo } from '../lib/format';
import { PanelShell, Section } from './StationPanel';

export default function SourcesPanel({ snapshot, lastSuccess, fetchError, onClose }: { snapshot: Snapshot; lastSuccess: number | null; fetchError: string | null; onClose: () => void }) {
  return (
    <PanelShell onClose={onClose} title="Data sources & health" sub={`Mode: ${snapshot.mode === 'server' ? 'local server with caching' : 'direct from browser (server not running)'}`}>
      <Section title="This app">
        <div className="card p-2.5 text-[12px]">
          <div>
            Last successful refresh: <b>{lastSuccess ? `${localTime(lastSuccess)} (${timeAgo(lastSuccess)})` : '—'}</b>
          </div>
          <div>Snapshot generated: {localTime(snapshot.generatedAt)}</div>
          {fetchError && <div className="text-amber-400">Last attempt failed: {fetchError}. Showing the last good data, marked stale where old.</div>}
          <div className="faint mt-1 text-[10.5px]">The app asks for new data every 120 s. Most gauges report every 15–60 minutes, so many refreshes bring no new measurements - each reading shows its own measurement time.</div>
        </div>
      </Section>
      <Section title="Upstream sources">
        <div className="space-y-1.5">
          {snapshot.sources.map((s) => (
            <div key={s.name} className="card flex gap-2 p-2.5 text-[12px]">
              {s.note ? <CircleSlash size={15} className="mt-0.5 shrink-0 text-slate-400" /> : s.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-amber-400" />}
              <div className="min-w-0">
                <div className="font-medium">{s.name}</div>
                {s.lastSuccess && <div className="faint text-[10.5px]">Last success {timeAgo(s.lastSuccess)}</div>}
                {s.error && <div className="text-[11px] text-amber-400">{s.error}</div>}
                {s.note && <div className="faint text-[11px]">{s.note}</div>}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Datums">
        <div className="faint text-[11.5px] leading-snug">
          River stage is reported in feet above each gauge's own zero ("gauge datum"), or in a tidal datum (MHHW) for estuary gauges. Stages from different gauges are never compared directly. Water-surface elevations are only shown where NOAA or USGS publish the gauge-zero elevation (NAVD88 or NGVD29), and
          comparisons only use the same datum.
        </div>
      </Section>
      <Section title="Map & GIS layers">
        <ul className="faint list-disc space-y-0.5 pl-4 text-[11.5px]">
          <li>Brevard County Public Works drainage ditches (gis.brevardfl.gov)</li>
          <li>SJRWMD water control structures, levees and drainage basins (ArcGIS Online)</li>
          <li>USGS National Hydrography Dataset & NHDPlus (hydro.nationalmap.gov, NLDI)</li>
          <li>FEMA National Flood Hazard Layer (hazards.fema.gov)</li>
          <li>USGS 3DEP elevation (Elevation Point Query Service, AWS Terrain Tiles)</li>
          <li>Base maps: CARTO / OpenStreetMap, Esri World Imagery, USGS Topo</li>
        </ul>
      </Section>
    </PanelShell>
  );
}
