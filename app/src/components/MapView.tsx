import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Crosshair, Home, Layers, Minimize2, Navigation, X } from 'lucide-react';
import type { Snapshot, Station } from '../shared/types';
import { BASIN_BBOX } from '../shared/config';
import { VECTOR_LAYERS } from '../shared/adapters/gis';
import { getLayer, getMainStem } from '../lib/api';
import { SEVERITY, TREND, severityRank } from '../lib/format';
import { loadPref, savePref, type Basemap, type LayerPrefs } from '../lib/prefs';
import { BASEMAPS, NHD_FTYPES, STRUCTURE_COLORS, STRUCTURE_TYPES, buildStyle, structureIcon } from './mapStyle';
import LayerPanel from './LayerPanel';
import Legend from './Legend';

interface Props {
  snapshot: Snapshot | null;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  layers: LayerPrefs;
  onLayers: (l: LayerPrefs) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  pin: { lat: number; lon: number } | null;
  pinMode: boolean;
  onPinMode: (v: boolean) => void;
  onDropPin: (lat: number, lon: number) => void;
  flyTo: { lat: number; lon: number; zoom?: number; t: number } | null;
  overlayGeo: { nhd: GeoJSON.FeatureCollection | null; terrain: [number, number][] | null };
  mapOnly: boolean;
  onExitMapOnly: () => void;
  onOpenAlerts: () => void;
  onOpenNearby: () => void;
  theme: 'dark' | 'light';
}

// The bundled app must tell MapLibre where its (separately built) worker script lives.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const basinBounds: maplibregl.LngLatBoundsLike = [BASIN_BBOX.xmin, BASIN_BBOX.ymin, BASIN_BBOX.xmax, BASIN_BBOX.ymax];
const basinView = { padding: 32, maxZoom: 8 };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Which vector sources each toggle needs. */
function wantedSources(l: LayerPrefs): Set<string> {
  const s = new Set<string>();
  if (l.hydro || l.canals || l.culverts) s.add('nhdFlowlines');
  if (l.ditches) s.add('ditches');
  if (l.cityStorm) {
    s.add('tvPipes');
    s.add('tvStructures');
    s.add('tvChannels');
  }
  if (l.cityBasins) s.add('tvBasins');
  if (l.structures) s.add('structures');
  if (l.nhdStructures) {
    s.add('nhdPoints');
    s.add('nhdLines');
  }
  if (l.levees) s.add('levees');
  if (l.ponds) s.add('nhdWaterbodies');
  if (l.basins) s.add('basins');
  if (l.subbasins) s.add('subbasins');
  return s;
}

function markerHtml(st: Station, selected: boolean, pulse: boolean) {
  const sev = SEVERITY[st.severity];
  const big = st.group === 'main' || severityRank(st.severity) >= severityRank('action');
  const stale = st.freshness === 'stale' || st.freshness === 'old' || st.freshness === 'none';
  const doPulse = pulse && severityRank(st.severity) >= severityRank('moderate') && st.freshness === 'fresh';
  const glyph = st.stage ? TREND[st.trend].glyph : '–';
  const label = st.stage ? `${st.stage.value.toFixed(2)} ft` : st.flow ? `${Math.round(st.flow.value).toLocaleString()} cfs` : 'no data';
  const cls = ['stn', big ? '' : 'small minor-label', stale ? 'stale' : '', selected ? 'selected' : ''].join(' ');
  return {
    cls,
    html: `<div class="stn-dot ${doPulse ? 'stn-pulse' : ''}" style="background:${sev.color};color:${sev.text};--pulse:${sev.color}">${glyph}</div><div class="stn-label">${label}${stale ? ' <span style="color:#fbbf24">⚠</span>' : ''}</div>`,
  };
}

function popupHtml(layerId: string, f: MapGeoJSONFeature): string {
  const p = f.properties ?? {};
  const get = (k: string) => p[k] ?? p[k.toUpperCase()] ?? p[k.toLowerCase()];
  const unknown = '<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(245,158,11,.14);color:#fbbf24;font-weight:600">Operational status unknown.</div><div style="opacity:.75;font-size:11px;margin-top:4px">No public real-time gate position, discharge or operating log is published for this structure. Never assume it is open or closed.</div>';
  const src = (s: string) => `<div style="opacity:.6;font-size:10.5px;margin-top:6px">Source: ${esc(s)}</div>`;
  switch (layerId) {
    case 'structures':
      return `<div style="font-weight:700;font-size:13.5px">${esc(get('NAME') || 'Unnamed structure')}</div><div style="opacity:.8">${esc(STRUCTURE_TYPES[get('TYPE')] ?? 'Water control structure')}${get('DESCRIPTION') ? ` · ${esc(get('DESCRIPTION'))}` : ''}</div>${get('COMMENTS') ? `<div style="margin-top:4px">${esc(get('COMMENTS'))}</div>` : ''}${unknown}${src(VECTOR_LAYERS.structures.source)}`;
    case 'nhd-points':
    case 'nhd-lines':
      return `<div style="font-weight:700">${esc(get('gnis_name') || NHD_FTYPES[get('ftype')] || 'Hydrographic structure')}</div><div style="opacity:.8">${esc(NHD_FTYPES[get('ftype')] ?? `NHD feature type ${get('ftype')}`)}</div>${unknown}${src(VECTOR_LAYERS.nhdPoints.source)}`;
    case 'ditches':
      return `<div style="font-weight:700">${esc(get('name') || 'Drainage ditch')}</div><div style="opacity:.8">${esc(get('type') ?? 'Ditch')}${get('location') ? ` · ${esc(get('location'))}` : ''}</div><div style="margin-top:6px">Mapped flow direction: <b>${esc(get('flow_dir') || 'not recorded')}</b></div><div>Maintained by: ${esc(get('maint_by') || '—')} · cycle ${esc(get('maint_cycle') || '—')}</div><div>Length: ${get('total_length_ft') ? `${Number(get('total_length_ft')).toLocaleString()} ft` : '—'}</div><div style="opacity:.7;font-size:11px;margin-top:4px">Flow direction is an attribute recorded by the county, not a live measurement.</div>${src(VECTOR_LAYERS.ditches.source)}`;
    case 'nhd-canals':
    case 'nhd-streams':
    case 'nhd-culverts':
      return `<div style="font-weight:700">${esc(get('gnis_name') || 'Unnamed')}</div><div style="opacity:.8">${esc(NHD_FTYPES[get('ftype')] ?? 'Flowline')}</div>${src(VECTOR_LAYERS.nhdFlowlines.source)}`;
    case 'tv-structures': {
      const top = get('Top_Elev');
      const inv = get('Invert_Elev');
      const datum = get('Elev_Datum');
      const elev = top || inv ? `<div>Top ${top ?? '—'} ft · invert ${inv ?? '—'} ft${datum && datum !== 'Not Populated' ? ` (${esc(datum)})` : ' (datum not recorded)'}</div>` : '<div style="opacity:.75">No elevations recorded</div>';
      return `<div style="font-weight:700">${esc(get('Hydraulic_Type_Desc') || 'Stormwater structure')}</div><div style="opacity:.8">${esc(get('FieldID') || '')} · owner ${esc(get('Ownership') || '—')}</div>${elev}${/control|weir/i.test(get('Hydraulic_Type_Desc') ?? '') ? unknown : ''}${src(VECTOR_LAYERS.tvStructures.source)}`;
    }
    case 'tv-pipes':
      return `<div style="font-weight:700">Stormwater pipe / culvert</div><div>${esc(get('Material_Type_Desc') || 'Material unknown')}${get('Rise_IN') ? ` · ${get('Rise_IN')}×${get('Span_IN')} in` : ''}</div><div>Length ${get('Pipe_Length') ? `${Math.round(get('Pipe_Length'))} ft` : '—'} · owner ${esc(get('Ownership') || '—')}</div><div style="opacity:.7;font-size:11px;margin-top:4px">Flow direction is not recorded in this dataset.</div>${src(VECTOR_LAYERS.tvPipes.source)}`;
    case 'tv-channels':
      return `<div style="font-weight:700">Stormwater channel</div><div>${esc(get('Subtype') || get('Usetype') || '')}${get('Width_Feet') ? ` · ${get('Width_Feet')} ft wide` : ''}</div><div>Owner ${esc(get('Ownership') || '—')}</div>${src(VECTOR_LAYERS.tvChannels.source)}`;
    case 'tv-basins-fill':
      return `<div style="font-weight:700">${esc(get('Basin_name') || 'City stormwater basin')}</div><div>${get('Area_acre') ? `${Math.round(get('Area_acre'))} acres` : ''}</div>${src(VECTOR_LAYERS.tvBasins.source)}`;
    case 'levees':
      return `<div style="font-weight:700">${esc(get('LEVEE_NAME') || 'Levee')}</div><div>Owner: ${esc(get('OWNER') || '—')}</div><div>Design top elevation: ${get('DSGN_TOP_ELEV') ? `${esc(get('DSGN_TOP_ELEV'))} ft` : 'not published'}</div>${src(VECTOR_LAYERS.levees.source)}`;
    case 'ponds': {
      const ft = get('ftype');
      return `<div style="font-weight:700">${esc(get('gnis_name') || (ft === 436 ? 'Reservoir' : 'Lake / pond'))}</div><div style="opacity:.8">${ft === 436 ? 'Reservoir (NHD)' : 'Lake / pond (NHD). Small ponds here are often stormwater retention ponds, but NHD does not say so - not verified.'}</div><div>Area: ${get('areasqkm') ? `${(Number(get('areasqkm')) * 247.1).toFixed(1)} acres` : '—'}</div>${src(VECTOR_LAYERS.nhdWaterbodies.source)}`;
    }
    case 'basins-fill':
      return `<div style="font-weight:700">${esc(get('MAJORBASINNAME') || 'Drainage basin')}</div>${src(VECTOR_LAYERS.basins.source)}`;
    case 'subbasins-fill': {
      const name = Object.entries(p).find(([k, v]) => /name/i.test(k) && v)?.[1];
      return `<div style="font-weight:700">${esc(name || 'Planning unit basin')}</div>${src(VECTOR_LAYERS.subbasins.source)}`;
    }
    case 'alert-fill':
      return `<div style="font-weight:700;color:#f87171">OFFICIAL NWS: ${esc(get('event'))}</div><div>${esc(get('headline'))}</div>`;
    default:
      return '';
  }
}

const INTERACTIVE = ['tv-structures', 'tv-pipes', 'tv-channels', 'tv-basins-fill', 'structures', 'nhd-points', 'nhd-lines', 'ditches', 'nhd-culverts', 'nhd-canals', 'levees', 'ponds', 'nhd-streams', 'alert-fill', 'subbasins-fill', 'basins-fill'];

export default function MapView(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLDivElement; inner: HTMLDivElement; key: string }>());
  const rainMarkers = useRef<maplibregl.Marker[]>([]);
  const pinMarker = useRef<maplibregl.Marker | null>(null);
  const [zoom, setZoom] = useState(0);
  const [layerOpen, setLayerOpen] = useState(false);
  const [layerStatus, setLayerStatus] = useState<Record<string, 'loading' | 'ok' | 'error' | 'zoom'>>({});
  const [mainStem, setMainStem] = useState<GeoJSON.FeatureCollection | null>(null);
  const loadedWhole = useRef(new Set<string>());
  const propsRef = useRef(p);
  propsRef.current = p;

  // ---- create the map once ----
  useEffect(() => {
    const saved = loadPref<{ center: [number, number]; zoom: number } | null>('basinView', null);
    const map = new maplibregl.Map({
      container: container.current!,
      style: buildStyle(),
      ...(saved ?? { bounds: basinBounds, fitBoundsOptions: basinView }),
      maxBounds: [
        [-84.5, 26.0],
        [-78.5, 31.8],
      ],
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    } as maplibregl.MapOptions);
    mapRef.current = map;
    setZoom(map.getZoom());
    (window as any).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    map.on('styleimagemissing', (e) => {
      if (e.id.startsWith('struct-') && !map.hasImage(e.id)) map.addImage(e.id, structureIcon(STRUCTURE_COLORS[0]));
    });
    map.on('load', () => {
      for (const [t, color] of Object.entries(STRUCTURE_COLORS)) if (!map.hasImage(`struct-${t}`)) map.addImage(`struct-${t}`, structureIcon(color));
      setReady(true);
    });
    map.on('zoom', () => setZoom(map.getZoom()));
    map.on('moveend', () => savePref('basinView', { center: map.getCenter().toArray(), zoom: map.getZoom() }));
    map.on('error', (e) => {
      // tile errors from optional overlays should not break the app
      if ((e as any)?.sourceId) return;
    });
    for (const id of INTERACTIVE) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = propsRef.current.pinMode ? 'crosshair' : 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = propsRef.current.pinMode ? 'crosshair' : ''));
    }
    map.on('click', (e) => {
      if (propsRef.current.pinMode) {
        propsRef.current.onDropPin(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const feats = map.queryRenderedFeatures(e.point, { layers: INTERACTIVE.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none') });
      if (!feats.length) return;
      const f = feats[0];
      const html = popupHtml(f.layer.id, f);
      if (html) new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- basemap ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [k, v] of Object.entries(BASEMAPS)) for (const l of v.layers) map.setLayoutProperty(l, 'visibility', k === p.basemap ? 'visible' : 'none');
  }, [p.basemap, ready]);

  // ---- overlay visibility ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const l = p.layers;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('mainstem', l.mainStem);
    vis('mainstem-glow', l.mainStem);
    vis('flow', l.mainStem && l.flowAnimation);
    vis('nhd', l.hydro);
    vis('nhd-streams', l.hydro);
    vis('nhd-canals', l.canals);
    vis('nhd-culverts', l.culverts);
    vis('ditches', l.ditches);
    vis('ditches-case', l.ditches);
    vis('tv-channels', l.cityStorm);
    vis('tv-pipes', l.cityStorm);
    vis('tv-structures', l.cityStorm);
    vis('tv-basins', l.cityBasins);
    vis('tv-basins-fill', l.cityBasins);
    vis('structures', l.structures);
    vis('nhd-points', l.nhdStructures);
    vis('nhd-lines', l.nhdStructures);
    vis('levees', l.levees);
    vis('ponds', l.ponds);
    vis('basins-fill', l.basins);
    vis('basins-line', l.basins);
    vis('subbasins-fill', l.subbasins);
    vis('subbasins-line', l.subbasins);
    vis('fema', l.fema);
    vis('hillshade', l.hillshade);
    vis('alert-fill', l.alertAreas);
    vis('alert-line', l.alertAreas);
    container.current?.classList.toggle('hide-labels', !l.labels);
  }, [p.layers, ready]);

  // ---- vector data loading (viewport based) ----
  const loadVectors = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const want = wantedSources(propsRef.current.layers);
    const z = map.getZoom();
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    await Promise.all(
      [...want].map(async (id) => {
        const def = VECTOR_LAYERS[id];
        const src = map.getSource(id) as GeoJSONSource | undefined;
        if (!def || !src) return;
        if (def.wholeDataset) {
          if (loadedWhole.current.has(id)) return;
          loadedWhole.current.add(id);
        } else if (z < def.minZoom) {
          setLayerStatus((s) => ({ ...s, [id]: 'zoom' }));
          return;
        }
        setLayerStatus((s) => ({ ...s, [id]: 'loading' }));
        try {
          const fc = await getLayer(id, def.wholeDataset ? null : bbox, z);
          src.setData(fc);
          setLayerStatus((s) => ({ ...s, [id]: 'ok' }));
        } catch {
          if (def.wholeDataset) loadedWhole.current.delete(id);
          setLayerStatus((s) => ({ ...s, [id]: 'error' }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => {
      clearTimeout(t);
      t = setTimeout(loadVectors, 350);
    };
    map.on('moveend', onMove);
    loadVectors();
    return () => {
      map.off('moveend', onMove);
      clearTimeout(t);
    };
  }, [ready, loadVectors, p.layers]);

  // ---- main stem (NHDPlus) ----
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const attempt = (n: number) =>
      getMainStem()
        .then((fc) => {
          if (cancelled) return;
          setMainStem(fc);
          (mapRef.current?.getSource('mainstem') as GeoJSONSource)?.setData(fc);
        })
        .catch(() => !cancelled && n < 4 && setTimeout(() => attempt(n + 1), 5000 * (n + 1)));
    attempt(0);
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // ---- flow-direction animation from measured discharge ----
  const flowInfo = useMemo(() => {
    if (!mainStem || !p.snapshot) return { fc: EMPTY, measured: 0, reversed: 0, total: 0 };
    const gauges = p.snapshot.stations.filter((s) => s.group === 'main' && s.flow && s.freshness !== 'old' && s.freshness !== 'none');
    const feats: GeoJSON.Feature[] = [];
    let reversed = 0;
    for (const f of mainStem.features) {
      if (f.geometry.type !== 'LineString') continue;
      const c = f.geometry.coordinates;
      const mid = c[Math.floor(c.length / 2)];
      let best: Station | null = null;
      let bd = Infinity;
      for (const g of gauges) {
        const d = Math.hypot((g.lon - mid[0]) * Math.cos((mid[1] * Math.PI) / 180), g.lat - mid[1]);
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      if (!best || bd > 0.35) continue; // > ~35 km from any discharge gauge: no animation
      const rev = best.flow!.value < 0;
      if (rev) reversed++;
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: rev ? [...c].reverse() : c } });
    }
    return { fc: { type: 'FeatureCollection' as const, features: feats }, measured: feats.length, reversed, total: mainStem.features.length };
  }, [mainStem, p.snapshot]);

  useEffect(() => {
    (mapRef.current?.getSource('flow') as GeoJSONSource | undefined)?.setData(flowInfo.fc);
  }, [flowInfo, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !p.layers.flowAnimation || !p.layers.mainStem) return;
    const seq = [
      [0, 4, 3],
      [0.5, 4, 2.5],
      [1, 4, 2],
      [1.5, 4, 1.5],
      [2, 4, 1],
      [2.5, 4, 0.5],
      [3, 4, 0],
      [0, 0.5, 3, 3.5],
      [0, 1, 3, 3],
      [0, 1.5, 3, 2.5],
      [0, 2, 3, 2],
      [0, 2.5, 3, 1.5],
      [0, 3, 3, 1],
      [0, 3.5, 3, 0.5],
    ];
    let step = 0;
    const id = setInterval(() => {
      step = (step + 1) % seq.length;
      if (map.getLayer('flow')) map.setPaintProperty('flow', 'line-dasharray', seq[step]);
    }, 90);
    return () => clearInterval(id);
  }, [ready, p.layers.flowAnimation, p.layers.mainStem]);

  // ---- official alert polygons ----
  useEffect(() => {
    const src = mapRef.current?.getSource('alertAreas') as GeoJSONSource | undefined;
    if (!src || !p.snapshot) return;
    src.setData({
      type: 'FeatureCollection',
      features: p.snapshot.alerts.filter((a) => a.geometry).map((a) => ({ type: 'Feature', geometry: a.geometry!, properties: { event: a.event, headline: a.headline } })),
    });
  }, [p.snapshot, ready]);

  // ---- station markers (updated in place on every refresh) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !p.snapshot) return;
    const seen = new Set<string>();
    const order = [...p.snapshot.stations].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    for (const st of order) {
      if (!p.layers.groups[st.group]) continue;
      seen.add(st.id);
      const { cls, html } = markerHtml(st, st.id === p.selectedId, p.layers.pulse);
      const key = cls + html;
      let entry = markers.current.get(st.id);
      if (!entry) {
        const el = document.createElement('div');
        const inner = document.createElement('div');
        el.appendChild(inner);
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (propsRef.current.pinMode) return;
          propsRef.current.onSelect(st.id);
        });
        el.addEventListener('keydown', (e) => e.key === 'Enter' && propsRef.current.onSelect(st.id));
        const m = new maplibregl.Marker({ element: el, anchor: 'left', offset: [st.group === 'main' || severityRank(st.severity) >= 2 ? -11 : -8, 0] }).setLngLat([st.lon, st.lat]).addTo(map);
        entry = { m, el, inner, key: '' };
        markers.current.set(st.id, entry);
      }
      if (entry.key !== key) {
        entry.inner.className = cls;
        entry.inner.innerHTML = html;
        entry.key = key;
      }
      entry.el.setAttribute('aria-label', `${st.name}: ${st.stage ? `${st.stage.value.toFixed(2)} feet, ${TREND[st.trend].label}` : 'no stage reading'}, ${SEVERITY[st.severity].label}`);
      entry.el.title = `${st.name}\n${SEVERITY[st.severity].label}${st.stage ? ` · ${st.stage.value.toFixed(2)} ft · ${TREND[st.trend].label}` : ''}`;
      entry.el.style.zIndex = String(severityRank(st.severity) + (st.id === p.selectedId ? 10 : 0));
    }
    for (const [id, e] of markers.current)
      if (!seen.has(id)) {
        e.m.remove();
        markers.current.delete(id);
      }
  }, [p.snapshot, p.selectedId, p.layers.groups, p.layers.pulse]);

  // labels: only bigger stations when zoomed out
  useEffect(() => {
    container.current?.classList.toggle('hide-minor-labels', zoom < 10.3);
  }, [zoom]);

  // ---- rain gauges ----
  useEffect(() => {
    const map = mapRef.current;
    rainMarkers.current.forEach((m) => m.remove());
    rainMarkers.current = [];
    if (!map || !p.snapshot || !p.layers.rain) return;
    for (const r of p.snapshot.rain) {
      const el = document.createElement('div');
      el.className = 'rain-marker';
      const inches = (value: number | undefined) => value === undefined ? '—' : value.toFixed(2) + '″';
      el.textContent = `☔ ${inches(r.totals.h24)}`;
      el.title = `${r.name}\n24 h: ${inches(r.totals.h24)} · 72 h: ${inches(r.totals.h72)} · 7 d: ${inches(r.totals.d7)}\n${r.source}${r.freshness !== 'fresh' ? ' · STALE' : ''}`;
      if (r.freshness !== 'fresh') el.style.opacity = '0.6';
      rainMarkers.current.push(new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 10] }).setLngLat([r.lon, r.lat]).addTo(map));
    }
  }, [p.snapshot, p.layers.rain]);

  // ---- pin ----
  useEffect(() => {
    const map = mapRef.current;
    pinMarker.current?.remove();
    pinMarker.current = null;
    if (!map || !p.pin) return;
    pinMarker.current = new maplibregl.Marker({ color: '#22d3ee' }).setLngLat([p.pin.lon, p.pin.lat]).addTo(map);
  }, [p.pin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('pinNhd') as GeoJSONSource).setData(p.overlayGeo.nhd ?? EMPTY);
    (map.getSource('pinTerrain') as GeoJSONSource).setData(
      p.overlayGeo.terrain && p.overlayGeo.terrain.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.overlayGeo.terrain } } : EMPTY,
    );
  }, [p.overlayGeo, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = p.pinMode ? 'crosshair' : '';
  }, [p.pinMode]);

  useEffect(() => {
    if (p.flyTo) mapRef.current?.flyTo({ center: [p.flyTo.lon, p.flyTo.lat], zoom: Math.max(mapRef.current.getZoom(), p.flyTo.zoom ?? 11), speed: 1.4 });
  }, [p.flyTo]);

  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 50);
  }, [p.mapOnly]);

  const officialFlood = p.snapshot?.alerts.filter((a) => a.isFlood && a.isWarning) ?? [];

  return (
    <div className="absolute inset-0">
      <div ref={container} style={{ position: 'absolute', inset: 0 }} aria-label="Map of the St. Johns River" role="application" />

      {/* top-left: layers and quick views */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl p-1">
          <button className={`btn border-0 ${layerOpen ? 'btn-active' : 'bg-transparent'}`} onClick={() => setLayerOpen(!layerOpen)} aria-expanded={layerOpen}>
            <Layers size={15} /> Layers
          </button>
          <div className="mx-0.5 h-5 w-px" style={{ background: 'var(--border)' }} />
          {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
            <button key={b} className={`btn border-0 px-2 ${p.basemap === b ? 'btn-active' : 'bg-transparent'}`} onClick={() => p.onBasemap(b)} aria-pressed={p.basemap === b}>
              {BASEMAPS[b].label}
            </button>
          ))}
        </div>
        <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl p-1 text-[12px]">
          <button className="btn border-0 bg-transparent px-2" onClick={() => mapRef.current?.fitBounds(basinBounds, basinView)} title="Whole river: headwaters to Jacksonville">
            <Home size={14} /> Whole river
          </button>
          <button className="btn border-0 bg-transparent px-2" onClick={p.onOpenNearby}>
            <Navigation size={14} /> Near me
          </button>
        </div>
        {layerOpen && <LayerPanel layers={p.layers} onLayers={p.onLayers} status={layerStatus} zoom={zoom} flowInfo={flowInfo} onClose={() => setLayerOpen(false)} />}
      </div>

      {officialFlood.length > 0 && (
        <button
          onClick={p.onOpenAlerts}
          className="fade-in absolute left-1/2 top-3 z-10 hidden -translate-x-1/2 items-center gap-2 rounded-xl border px-3 py-1.5 text-[12.5px] font-semibold shadow-lg xl:flex"
          style={{ background: 'rgba(127,29,29,0.85)', borderColor: 'rgba(248,113,113,0.6)', color: '#fee2e2', backdropFilter: 'blur(8px)' }}
        >
          <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">OFFICIAL NWS</span>
          {officialFlood.length} Flood Warning{officialFlood.length > 1 ? 's' : ''} in effect for basin counties
        </button>
      )}

      {p.pinMode && (
        <div className="glass fade-in absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2 text-sm">
          <Crosshair size={16} className="accent" /> Click anywhere on the map to drop an analysis pin
          <button className="icon-btn h-7 w-7" onClick={() => p.onPinMode(false)} aria-label="Cancel pin">
            <X size={14} />
          </button>
        </div>
      )}

      {p.mapOnly && (
        <button className="glass btn absolute right-14 top-3 z-10" onClick={p.onExitMapOnly}>
          <Minimize2 size={14} /> Exit full screen
        </button>
      )}

      <Legend layers={p.layers} />
      {!p.snapshot && (
        <div className="glass absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-sm">
          <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" /> Loading live river data from NOAA, USGS and NWS…
        </div>
      )}
    </div>
  );
}
