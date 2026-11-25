import { AlertCircle, Loader2, X, ZoomIn } from 'lucide-react';
import { VECTOR_LAYERS } from '../shared/adapters/gis';
import { GROUP_LABEL } from '../lib/format';
import type { LayerPrefs } from '../lib/prefs';

interface Props {
  layers: LayerPrefs;
  onLayers: (l: LayerPrefs) => void;
  status: Record<string, 'loading' | 'ok' | 'error' | 'zoom'>;
  zoom: number;
  flowInfo: { measured: number; reversed: number; total: number };
  onClose: () => void;
}

type BoolKey = { [K in keyof LayerPrefs]: LayerPrefs[K] extends boolean ? K : never }[keyof LayerPrefs];

const SECTIONS: { title: string; items: { key: BoolKey; label: string; swatch: string; src?: string[]; note?: string }[] }[] = [
  {
    title: 'River',
    items: [
      { key: 'mainStem', label: 'St. Johns main stem', swatch: '#22d3ee', note: 'USGS NHDPlus mainstem, headwaters to the mouth' },
      { key: 'flowAnimation', label: 'Animated flow direction', swatch: '#ecfeff', note: 'Only near gauges measuring discharge; reverses where measured flow is negative (tidal)' },
      { key: 'hydro', label: 'Lakes, rivers & tributaries', swatch: '#38bdf8', src: ['nhdFlowlines'] },
      { key: 'rain', label: 'Rain gauges (24 h)', swatch: '#67e8f9' },
      { key: 'alertAreas', label: 'Official NWS alert areas', swatch: '#f87171' },
    ],
  },
  {
    title: 'Drainage & flood control',
    items: [
      { key: 'ditches', label: 'Drainage ditches (Brevard)', swatch: '#f59e0b', src: ['ditches'] },
      { key: 'cityStorm', label: 'Titusville pipes, inlets & channels', swatch: '#e879f9', src: ['tvPipes', 'tvStructures', 'tvChannels'], note: 'City of Titusville stormwater inventory (pipes, control structures, weirs, inlets)' },
      { key: 'cityBasins', label: 'Titusville stormwater basins', swatch: '#fbbf24', src: ['tvBasins'] },
      { key: 'canals', label: 'Stormwater canals & ditches (NHD)', swatch: '#2dd4bf', src: ['nhdFlowlines'] },
      { key: 'culverts', label: 'Culverts & pipelines (NHD)', swatch: '#f472b6', src: ['nhdFlowlines'] },
      { key: 'structures', label: 'Gates, weirs, pumps, culverts (SJRWMD)', swatch: '#f43f5e', src: ['structures'] },
      { key: 'nhdStructures', label: 'Dams, weirs & gates (NHD)', swatch: '#fde047', src: ['nhdPoints', 'nhdLines'] },
      { key: 'levees', label: 'Levees (SJRWMD)', swatch: '#d6a36a', src: ['levees'] },
      { key: 'ponds', label: 'Reservoirs & ponds (NHD)', swatch: '#8b5cf6', src: ['nhdWaterbodies'], note: 'Ponds may be stormwater retention ponds - not verified' },
      { key: 'basins', label: 'Major drainage basins', swatch: '#7dd3fc', src: ['basins'] },
      { key: 'subbasins', label: 'Planning-unit drainage basins', swatch: '#c4b5fd', src: ['subbasins'] },
    ],
  },
  {
    title: 'Hazard & terrain',
    items: [
      { key: 'fema', label: 'FEMA flood zones', swatch: '#3b82f6', note: 'Visible from zoom 10' },
      { key: 'hillshade', label: 'Terrain shading (USGS 3DEP)', swatch: '#94a3b8' },
    ],
  },
  {
    title: 'Markers',
    items: [
      { key: 'labels', label: 'Water-level labels', swatch: '#e2e8f0' },
      { key: 'pulse', label: 'Pulse stations in moderate/major flood', swatch: '#a855f7' },
    ],
  },
];

export default function LayerPanel({ layers, onLayers, status, zoom, flowInfo, onClose }: Props) {
  const set = (k: BoolKey, v: boolean) => onLayers({ ...layers, [k]: v });
  return (
    <div className="glass pointer-events-auto fade-in scroll-thin max-h-[calc(100vh-190px)] w-[318px] overflow-y-auto rounded-xl p-3 text-[12.5px]" role="dialog" aria-label="Map layers">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Map layers</div>
        <button className="icon-btn h-7 w-7" onClick={onClose} aria-label="Close layers">
          <X size={14} />
        </button>
      </div>
      {SECTIONS.map((sec) => (
        <div key={sec.title} className="mb-2.5">
          <div className="label-xs mb-1">{sec.title}</div>
          {sec.items.map((it) => {
            const st = it.src?.map((s) => status[s]).find((x) => x && x !== 'ok');
            const minZoom = it.src?.map((s) => VECTOR_LAYERS[s]?.minZoom ?? 0).reduce((a, b) => Math.max(a, b), 0) ?? 0;
            return (
              <label key={it.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--panel-2)]">
                <input type="checkbox" className="mt-0.5 accent-cyan-500" checked={layers[it.key]} onChange={(e) => set(it.key, e.target.checked)} />
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.swatch }} />
                <span className="flex-1">
                  {it.label}
                  {layers[it.key] && st === 'loading' && <Loader2 size={11} className="ml-1 inline animate-spin opacity-70" />}
                  {layers[it.key] && st === 'error' && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-[10.5px] text-amber-400">
                      <AlertCircle size={10} /> source unavailable
                    </span>
                  )}
                  {layers[it.key] && zoom < minZoom && (
                    <span className="faint ml-1 inline-flex items-center gap-0.5 text-[10.5px]">
                      <ZoomIn size={10} /> zoom in to {minZoom}+
                    </span>
                  )}
                  {it.note && <span className="faint block text-[10.5px] leading-snug">{it.note}</span>}
                  {it.key === 'flowAnimation' && layers.flowAnimation && flowInfo.total > 0 && (
                    <span className="faint block text-[10.5px]">
                      Animated on {flowInfo.measured}/{flowInfo.total} reaches{flowInfo.reversed ? `, ${flowInfo.reversed} reversed by measured negative flow` : ''}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      ))}
      <div className="label-xs mb-1">Station groups</div>
      {(Object.keys(layers.groups) as (keyof LayerPrefs['groups'])[]).map((g) => (
        <label key={g} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--panel-2)]">
          <input type="checkbox" className="accent-cyan-500" checked={layers.groups[g]} onChange={(e) => onLayers({ ...layers, groups: { ...layers.groups, [g]: e.target.checked } })} />
          {GROUP_LABEL[g]}
        </label>
      ))}
      <p className="faint mt-2 text-[10.5px] leading-snug">
        Infrastructure comes from public GIS inventories (City of Titusville, Brevard County, SJRWMD, USGS NHD). No public source publishes live gate positions or pump status for these structures, so every structure reads "Operational status unknown".
      </p>
    </div>
  );
}
