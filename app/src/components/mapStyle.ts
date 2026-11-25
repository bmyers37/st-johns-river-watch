import type { StyleSpecification } from 'maplibre-gl';
import { ENDPOINTS } from '../shared/config';
import type { Basemap } from '../lib/prefs';

const exportTiles = (service: string, layers: string) =>
  `${service}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:${layers}&f=image`;

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const geo = () => ({ type: 'geojson' as const, data: empty });

export const BASEMAPS: Record<Basemap, { label: string; layers: string[] }> = {
  dark: { label: 'Dark', layers: ['bm-dark', 'bm-dark-labels'] },
  streets: { label: 'Streets', layers: ['bm-streets'] },
  satellite: { label: 'Satellite', layers: ['bm-sat', 'bm-sat-labels'] },
  terrain: { label: 'Terrain', layers: ['bm-topo', 'bm-topo-shade'] },
};

export const VECTOR_SOURCES = ['tvPipes', 'tvStructures', 'tvChannels', 'tvBasins', 'nhdFlowlines', 'ditches', 'structures', 'nhdPoints', 'nhdLines', 'levees', 'nhdWaterbodies', 'basins', 'subbasins'] as const;

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      'bm-dark': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'Base map © Esri, HERE, Garmin, © OpenStreetMap contributors',
      },
      'bm-dark-labels': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
      },
      'bm-streets': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Base map © Esri, HERE, Garmin, USGS, © OpenStreetMap contributors',
      },
      'bm-sat': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, USDA, USGS',
      },
      'bm-sat-labels': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
      },
      'bm-topo': {
        type: 'raster',
        tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'USGS The National Map: 3DEP, NHD, Structures, Transportation',
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Elevation: AWS Terrain Tiles (USGS 3DEP)',
      },
      fema: {
        type: 'raster',
        tiles: [exportTiles(ENDPOINTS.fema, '28')],
        tileSize: 256,
        minzoom: 10,
        attribution: 'FEMA National Flood Hazard Layer',
      },
      nhd: {
        type: 'raster',
        // flowlines + open-water bodies only (swamp/marsh fills make the map too busy)
        tiles: [`${exportTiles(ENDPOINTS.nhd, '4,6,10,12')}&layerDefs=${encodeURIComponent(JSON.stringify({ 10: 'ftype IN (390,436,493)', 12: 'ftype IN (390,436,493)' }))}`],
        tileSize: 256,
        attribution: 'USGS National Hydrography Dataset',
      },
      mainstem: geo(),
      flow: geo(),
      alertAreas: geo(),
      pinNhd: geo(),
      pinTerrain: geo(),
      squires: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-80.8756, 28.6512] }, properties: {} } },
      ...Object.fromEntries(VECTOR_SOURCES.map((s) => [s, geo()])),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#081226' } },
      { id: 'bm-dark', type: 'raster', source: 'bm-dark', paint: { 'raster-opacity': 0.82, 'raster-brightness-max': 0.75, 'raster-contrast': 0.1 } },
      { id: 'bm-streets', type: 'raster', source: 'bm-streets', layout: { visibility: 'none' } },
      { id: 'bm-sat', type: 'raster', source: 'bm-sat', layout: { visibility: 'none' } },
      { id: 'bm-sat-labels', type: 'raster', source: 'bm-sat-labels', layout: { visibility: 'none' } },
      { id: 'bm-topo', type: 'raster', source: 'bm-topo', layout: { visibility: 'none' } },
      { id: 'bm-topo-shade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#334155' } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.85, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#0e7490' } },
      { id: 'fema', type: 'raster', source: 'fema', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } },
      { id: 'nhd', type: 'raster', source: 'nhd', paint: { 'raster-opacity': 0.75 } },
      { id: 'basins-fill', type: 'fill', source: 'basins', layout: { visibility: 'none' }, paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.04 } },
      { id: 'basins-line', type: 'line', source: 'basins', layout: { visibility: 'none' }, paint: { 'line-color': '#7dd3fc', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [4, 2] } },
      { id: 'subbasins-fill', type: 'fill', source: 'subbasins', layout: { visibility: 'none' }, paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.03 } },
      { id: 'subbasins-line', type: 'line', source: 'subbasins', layout: { visibility: 'none' }, paint: { 'line-color': '#c4b5fd', 'line-width': 1, 'line-opacity': 0.6 } },
      {
        id: 'ponds',
        type: 'fill',
        source: 'nhdWaterbodies',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': ['match', ['coalesce', ['get', 'ftype'], ['get', 'FTYPE']], 436, '#8b5cf6', '#06b6d4'],
          'fill-opacity': 0.45,
          'fill-outline-color': '#e0f2fe',
        },
      },
      { id: 'alert-fill', type: 'fill', source: 'alertAreas', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.05 } },
      { id: 'alert-line', type: 'line', source: 'alertAreas', paint: { 'line-color': '#f87171', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } },
      {
        id: 'nhd-streams',
        type: 'line',
        source: 'nhdFlowlines',
        filter: ['in', ['get', 'ftype'], ['literal', [460, 558]]],
        paint: { 'line-color': '#38bdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 2.5], 'line-opacity': 0.8 },
      },
      {
        id: 'nhd-canals',
        type: 'line',
        source: 'nhdFlowlines',
        filter: ['==', ['get', 'ftype'], 336],
        paint: { 'line-color': '#2dd4bf', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3], 'line-opacity': 0.9 },
      },
      {
        id: 'nhd-culverts',
        type: 'line',
        source: 'nhdFlowlines',
        filter: ['in', ['get', 'ftype'], ['literal', [428, 420]]],
        paint: { 'line-color': '#f472b6', 'line-width': 2.5, 'line-dasharray': [1, 1] },
      },
      { id: 'ditches-case', type: 'line', source: 'ditches', paint: { 'line-color': '#1c1917', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 6], 'line-opacity': 0.6 } },
      { id: 'ditches', type: 'line', source: 'ditches', paint: { 'line-color': '#f59e0b', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.3, 16, 3.5] } },
      { id: 'tv-basins', type: 'line', source: 'tvBasins', layout: { visibility: 'none' }, paint: { 'line-color': '#fbbf24', 'line-width': 1.2, 'line-opacity': 0.7, 'line-dasharray': [3, 2] } },
      { id: 'tv-basins-fill', type: 'fill', source: 'tvBasins', layout: { visibility: 'none' }, paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.03 } },
      { id: 'tv-channels', type: 'line', source: 'tvChannels', paint: { 'line-color': '#fb923c', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 4] } },
      { id: 'tv-pipes', type: 'line', source: 'tvPipes', paint: { 'line-color': '#e879f9', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 3], 'line-dasharray': [2, 1] } },
      { id: 'tv-structures', type: 'circle', source: 'tvStructures', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 5], 'circle-color': ['match', ['get', 'Hydraulic_Type_Desc'], 'Control Structure', '#f43f5e', 'Weir', '#eab308', 'Baffle Box', '#22c55e', '#e2e8f0'], 'circle-stroke-color': '#0b1220', 'circle-stroke-width': 1 } },
      { id: 'levees', type: 'line', source: 'levees', layout: { visibility: 'none' }, paint: { 'line-color': '#d6a36a', 'line-width': 2.5, 'line-dasharray': [2, 1] } },
      { id: 'mainstem-glow', type: 'line', source: 'mainstem', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#22d3ee', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 6, 12, 16], 'line-opacity': 0.22, 'line-blur': 6 } },
      { id: 'mainstem', type: 'line', source: 'mainstem', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#22d3ee', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.8, 12, 4], 'line-opacity': 0.95 } },
      { id: 'flow', type: 'line', source: 'flow', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#ecfeff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 2.6], 'line-opacity': 0.85, 'line-dasharray': [0, 4, 3] } },
      { id: 'nhd-lines', type: 'line', source: 'nhdLines', layout: { visibility: 'none' }, paint: { 'line-color': '#fde047', 'line-width': 4 } },
      { id: 'nhd-points', type: 'circle', source: 'nhdPoints', layout: { visibility: 'none' }, paint: { 'circle-radius': 5, 'circle-color': '#fde047', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } },
      { id: 'bm-dark-labels', type: 'raster', source: 'bm-dark-labels', paint: { 'raster-opacity': 0.9 } },
      {
        id: 'structures',
        type: 'symbol',
        source: 'structures',
        layout: {
          'icon-image': ['concat', 'struct-', ['to-string', ['coalesce', ['get', 'TYPE'], 0]]],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 12, 0.85, 15, 1.1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
      { id: 'pin-terrain', type: 'line', source: 'pinTerrain', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#fb923c', 'line-width': 3, 'line-dasharray': [1.5, 1.2] } },
      { id: 'pin-nhd', type: 'line', source: 'pinNhd', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#60a5fa', 'line-width': 4, 'line-opacity': 0.95 } },
      { id: 'squires', type: 'circle', source: 'squires', minzoom: 11, paint: { 'circle-radius': 5, 'circle-color': 'transparent', 'circle-stroke-color': '#22d3ee', 'circle-stroke-width': 2 } },
    ],
  };
}

export const STRUCTURE_COLORS: Record<number, string> = { 0: '#94a3b8', 1: '#f43f5e', 2: '#eab308', 3: '#ec4899', 5: '#f97316', 8: '#84cc16', 9: '#94a3b8', 10: '#eab308' };

/** Diamond icons so control structures never look like the round station markers. */
export function structureIcon(color: string, size = 22): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const h = size / 2;
  ctx.beginPath();
  ctx.moveTo(h, 1.5);
  ctx.lineTo(size - 1.5, h);
  ctx.lineTo(h, size - 1.5);
  ctx.lineTo(1.5, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0b1220';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(h, h, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1220';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

export const STRUCTURE_TYPES: Record<number, string> = { 1: 'Pump', 2: 'Weir', 3: 'Culvert', 5: 'Spillway / dam', 8: 'Flashboard riser', 9: 'Manhole', 10: 'Weir box' };
export const NHD_FTYPES: Record<number, string> = {
  336: 'Canal / ditch',
  343: 'Dam / weir',
  369: 'Gate',
  398: 'Lock chamber',
  390: 'Lake / pond',
  420: 'Underground conduit',
  428: 'Pipeline / culvert',
  436: 'Reservoir',
  441: 'Reservoir',
  460: 'Stream / river',
  558: 'Artificial path (through a lake or wide river)',
  568: 'Levee',
  367: 'Gaging station',
  458: 'Spring / seep',
  488: 'Well',
};
