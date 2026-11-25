// Public GIS layers (ArcGIS REST feature queries returned as GeoJSON) and NHDPlus / elevation services.
import { ENDPOINTS } from '../config';
import { fetchJson, isObj } from '../http';
import type { PointInfo } from '../types';

export type BBox = [number, number, number, number]; // west, south, east, north

const TITUSVILLE = ENDPOINTS.titusville;

export interface VectorLayerDef {
  id: string;
  url: string; // ArcGIS layer URL ending in /<layerId>
  where?: string;
  outFields: string;
  minZoom: number;
  wholeDataset?: boolean; // small layers are fetched once for the whole basin
  simplify?: boolean;
  source: string;
}

export const VECTOR_LAYERS: Record<string, VectorLayerDef> = {
  ditches: {
    id: 'ditches',
    url: `${ENDPOINTS.brevard}/Hosted/External_PW_Roadways_and_Drainage_Ditches/FeatureServer/1`,
    outFields: 'name,type,flow_dir,location,maint_by,maint_cycle,total_length_ft,last_fy_maintained,zone,ditch_number',
    minZoom: 11,
    source: 'Brevard County Public Works - Drainage Ditches',
  },
  tvPipes: {
    id: 'tvPipes',
    url: `${TITUSVILLE}/2`,
    outFields: 'HydroID,Material_Type_Desc,Shape_Desc,Rise_IN,Span_IN,Pipe_Length,Ownership,Source',
    minZoom: 13,
    source: 'City of Titusville Stormwater - Pipes / culverts',
  },
  tvStructures: {
    id: 'tvStructures',
    url: `${TITUSVILLE}/3`,
    outFields: 'FieldID,Hydraulic_Type_Desc,Inlet_Type,End_Type,Top_Elev,Invert_Elev,Elev_Datum,Ownership,Comments',
    minZoom: 13,
    source: 'City of Titusville Stormwater - Structures (inlets, control structures, weirs, baffle boxes)',
  },
  tvChannels: {
    id: 'tvChannels',
    url: `${TITUSVILLE}/1`,
    outFields: 'FacilityID,Ownership,Usetype,Subtype,Width_Feet,Depth_Inch,Material,Length_Fee,Comments',
    minZoom: 12,
    source: 'City of Titusville Stormwater - Channels',
  },
  tvBasins: {
    id: 'tvBasins',
    url: `${TITUSVILLE}/0`,
    outFields: 'Basin_name,Area_acre',
    minZoom: 0,
    wholeDataset: true,
    simplify: true,
    source: 'City of Titusville Stormwater - Basins',
  },
  structures: {
    id: 'structures',
    url: `${ENDPOINTS.sjrwmd}/Water_Control_Structure/FeatureServer/9`,
    outFields: 'NAME,TYPE,DESCRIPTION,STATUS,CONTROL,MANAGER,COMMENTS,HYDROID',
    minZoom: 0,
    wholeDataset: true,
    source: 'SJRWMD Water Resources Geodatabase - Water Control Structures',
  },
  levees: {
    id: 'levees',
    url: `${ENDPOINTS.sjrwmd}/Levee/FeatureServer/0`,
    outFields: 'LEVEE_NAME,OWNER,LEVEE_LNGTH,DSGN_TOP_ELEV,LEVEE_ACTVTY',
    minZoom: 0,
    wholeDataset: true,
    simplify: true,
    source: 'SJRWMD - Levees',
  },
  basins: {
    id: 'basins',
    url: `${ENDPOINTS.sjrwmd}/Major_Drainage_Basin_24K_2013/FeatureServer/0`,
    outFields: 'MAJORBASINNAME',
    minZoom: 0,
    wholeDataset: true,
    simplify: true,
    source: 'SJRWMD - Major Drainage Basins (1:24,000, 2013)',
  },
  subbasins: {
    id: 'subbasins',
    url: `${ENDPOINTS.sjrwmd}/Planning_Unit_Drainage_Basin_24K_2013/FeatureServer/18`,
    outFields: '*',
    minZoom: 11,
    simplify: true,
    source: 'SJRWMD - Planning Unit Drainage Basins (1:24,000, 2013)',
  },
  nhdFlowlines: {
    id: 'nhdFlowlines',
    url: `${ENDPOINTS.nhd}/6`,
    where: 'ftype IN (336,460,428,420,558)',
    outFields: 'gnis_name,ftype,fcode,flowdir',
    minZoom: 11,
    simplify: true,
    source: 'USGS National Hydrography Dataset (NHD) flowlines',
  },
  nhdWaterbodies: {
    id: 'nhdWaterbodies',
    url: `${ENDPOINTS.nhd}/12`,
    where: 'ftype IN (390,436)',
    outFields: 'gnis_name,ftype,fcode,areasqkm',
    minZoom: 12,
    simplify: true,
    source: 'USGS National Hydrography Dataset (NHD) waterbodies',
  },
  nhdPoints: {
    id: 'nhdPoints',
    url: `${ENDPOINTS.nhd}/0`,
    where: 'FTYPE IN (343,369,398,441)',
    outFields: 'gnis_name,ftype,fcode',
    minZoom: 11,
    source: 'USGS National Hydrography Dataset (NHD) points (gates, dams/weirs, gaging stations...)',
  },
  nhdLines: {
    id: 'nhdLines',
    url: `${ENDPOINTS.nhd}/2`,
    where: 'FTYPE IN (343,369,398)',
    outFields: 'gnis_name,ftype,fcode',
    minZoom: 11,
    source: 'USGS National Hydrography Dataset (NHD) lines (dams/weirs, gates, levees...)',
  },
};

export async function queryArcgisGeojson(def: VectorLayerDef, bbox: BBox | null, zoom = 12): Promise<GeoJSON.FeatureCollection> {
  const params = new URLSearchParams({
    where: def.where ?? '1=1',
    outFields: def.outFields,
    outSR: '4326',
    f: 'geojson',
    returnGeometry: 'true',
    resultRecordCount: '2000',
  });
  if (bbox) {
    params.set('geometry', bbox.map((n) => n.toFixed(5)).join(','));
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', '4326');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }
  if (def.simplify) {
    // Generalise geometry to roughly one screen pixel at the requested zoom (degrees).
    const deg = 360 / (256 * 2 ** Math.max(6, Math.min(zoom, 16)));
    params.set('maxAllowableOffset', deg.toFixed(7));
    params.set('geometryPrecision', '6');
  }
  const j = await fetchJson(`${def.url}/query?${params}`, (x): x is GeoJSON.FeatureCollection => isObj(x) && Array.isArray((x as any).features), {
    timeoutMs: 40000,
  });
  return { type: 'FeatureCollection', features: j.features };
}

/** St. Johns main stem from NHDPlus: upstream from Jacksonville to the headwaters, plus Jacksonville to the mouth. */
export async function fetchMainStem(): Promise<GeoJSON.FeatureCollection> {
  const up = await fetchJson<GeoJSON.FeatureCollection>(`${ENDPOINTS.nldi}/nwissite/USGS-02246500/navigation/UM/flowlines?distance=800`, undefined, { timeoutMs: 60000 });
  let down: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  try {
    down = await fetchJson<GeoJSON.FeatureCollection>(`${ENDPOINTS.nldi}/nwissite/USGS-02246500/navigation/DM/flowlines?distance=60`, undefined, { timeoutMs: 60000 });
  } catch {
    /* lower reach optional */
  }
  return { type: 'FeatureCollection', features: [...up.features, ...down.features] };
}

export async function fetchGroundElevation(lat: number, lon: number): Promise<number | null> {
  const j: any = await fetchJson(`${ENDPOINTS.epqs}?x=${lon.toFixed(6)}&y=${lat.toFixed(6)}&units=Feet&wkid=4326&includeDate=false`, (x): x is any => isObj(x), {
    timeoutMs: 20000,
    retries: 2,
  });
  const v = parseFloat(j.value);
  return isFinite(v) && v > -1000 ? v : null;
}

const destination = (lat: number, lon: number, bearingDeg: number, distM: number): [number, number] => {
  const R = 6371000;
  const b = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const δ = distM / R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI];
};

/** Ground elevation at a point and a ring of samples around it, plus the mapped NHDPlus path downstream. */
export async function fetchPointInfo(lat: number, lon: number): Promise<PointInfo> {
  const errors: string[] = [];
  const info: PointInfo = { lat, lon, groundElevation: null, ring: [], hydrography: { downstream: null, note: '' }, errors };
  const ringSpec: { bearing: number; distanceM: number }[] = [];
  for (const d of [150, 400]) for (let b = 0; b < 360; b += 45) ringSpec.push({ bearing: b, distanceM: d });

  const centre = fetchGroundElevation(lat, lon)
    .then((v) => {
      if (v !== null) info.groundElevation = { value: v, unit: 'ft', datum: 'NAVD88', source: 'USGS 3DEP via Elevation Point Query Service', resolutionM: undefined };
    })
    .catch((e) => errors.push(`Ground elevation unavailable: ${(e as Error).message}`));

  const ring = Promise.all(
    ringSpec.map(async (r) => {
      const [la, lo] = destination(lat, lon, r.bearing, r.distanceM);
      try {
        return { ...r, value: await fetchGroundElevation(la, lo) };
      } catch {
        return { ...r, value: null };
      }
    }),
  ).then((rs) => (info.ring = rs));

  const hydro = (async () => {
    try {
      const pos = await fetchJson<GeoJSON.FeatureCollection>(`${ENDPOINTS.nldi}/comid/position?coords=POINT(${lon.toFixed(6)}%20${lat.toFixed(6)})`, undefined, { timeoutMs: 30000 });
      const comid = String((pos.features[0]?.properties as any)?.comid ?? pos.features[0]?.properties?.identifier ?? '');
      if (!comid) throw new Error('no NHDPlus catchment found');
      info.hydrography.comid = comid;
      const dm = await fetchJson<GeoJSON.FeatureCollection>(`${ENDPOINTS.nldi}/comid/${comid}/navigation/DM/flowlines?distance=150`, undefined, { timeoutMs: 40000 });
      info.hydrography.downstream = dm;
      info.hydrography.note =
        'Mapped flow path from the USGS NHDPlus V2 network for the catchment containing this point. It follows mapped streams and canals; it does not include culverts, pipes or pumps that are not in NHDPlus and is not an engineering assessment.';
    } catch (e) {
      info.hydrography.note = `NHDPlus network path unavailable: ${(e as Error).message}`;
    }
  })();

  await Promise.all([centre, ring, hydro]);
  return info;
}
